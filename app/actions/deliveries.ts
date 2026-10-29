"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { driverLabel, fmtDate, todayMY } from "@/lib/format";
import { mapsEnabled, updateDistances } from "@/lib/geo";
import { branchFromDoNo, branchToSave, canPlan } from "@/lib/branches";
import { TIME_SLOTS, type DoStatus } from "@/lib/types";
import { notYourBranch } from "./_shared";

// ---------- Delivery orders (staff) ----------------------------------

/** Special DO keyed in by the office (not from AutoCount): own address, points and instructions. */
export async function createSpecialDo(formData: FormData) {
  const { supabase, profile } = await requireStaff();
  const get = (k: string) => String(formData.get(k) ?? "").trim() || null;
  const points = Number(formData.get("points"));
  const driverId = get("driver_id");
  const date = get("delivery_date") ?? todayMY();
  if (!get("customer_name")) throw new Error("Enter who it's delivered to.");
  if (!Number.isInteger(points) || points < 0 || points > 99) throw new Error("Points must be a whole number from 0 to 99.");

  const { data: d, error } = await supabase
    .from("delivery_orders")
    .insert({
      customer_name: get("customer_name")!,
      address: get("address"),
      contact_phone: get("contact_phone"),
      delivery_date: date,
      branch: branchToSave(profile, get("branch")), // dispatchers always create for one of their own branches
      driver_id: driverId,
      status: driverId ? "assigned" : "pending",
      instructions: get("instructions"),
      points,
      points_manual: true,
      source: "special",
    })
    .select("id, do_no")
    .single();
  if (error || !d) throw new Error(error?.message ?? "Could not create the special DO");

  await supabase.from("status_events").insert({ do_id: d.id, status: "do_created", note: `${d.do_no} special DO created` });
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
  redirect(`/deliveries?from=${date}&to=${date}`);
}

/** Special DOs can be changed or deleted until the driver starts it. */
const SPECIAL_EDITABLE: DoStatus[] = ["pending", "assigned", "failed"];

/** Only whoever keyed in a special DO (or an admin) may change or delete it. */
async function ownSpecialDo(id: string) {
  const s = await requireStaff();
  const { data: d } = await s.supabase
    .from("delivery_orders")
    .select("id, do_no, source, status, driver_id, created_by")
    .eq("id", id)
    .single();
  if (!d || d.source !== "special") throw new Error("Special DO not found.");
  if (d.created_by !== s.user.id && s.profile.role !== "admin") throw new Error("Only the person who created this special DO can change it.");
  if (!SPECIAL_EDITABLE.includes(d.status)) throw new Error(`${d.do_no} can't be changed any more — the driver has already started or delivered it.`);
  return { ...s, d };
}

export async function updateSpecialDo(id: string, formData: FormData) {
  const { supabase, profile, d } = await ownSpecialDo(id);
  const get = (k: string) => String(formData.get(k) ?? "").trim() || null;
  const points = Number(formData.get("points"));
  const driverId = get("driver_id");
  const date = get("delivery_date") ?? todayMY();
  if (!get("customer_name")) throw new Error("Enter who it's delivered to.");
  if (!Number.isInteger(points) || points < 0 || points > 99) throw new Error("Points must be a whole number from 0 to 99.");

  // A new driver (or none) resets the status like Assign does; same driver keeps it.
  const driverChanged = driverId !== d.driver_id;
  const { error } = await supabase
    .from("delivery_orders")
    .update({
      customer_name: get("customer_name")!,
      address: get("address"),
      contact_phone: get("contact_phone"),
      delivery_date: date,
      branch: branchToSave(profile, get("branch")),
      driver_id: driverId,
      ...(driverChanged ? { status: driverId ? "assigned" : "pending", failed_reason: null } : {}),
      instructions: get("instructions"),
      points,
      points_manual: true,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await supabase.from("status_events").insert({ do_id: id, status: driverChanged ? (driverId ? "assigned" : "pending") : d.status, note: `${d.do_no} special DO edited` });
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
  redirect(`/deliveries?from=${date}&to=${date}`);
}

export async function deleteSpecialDo(id: string) {
  const { supabase } = await ownSpecialDo(id);
  // Its items, history and outstanding notes go with it (on delete cascade).
  const { error } = await supabase.from("delivery_orders").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
  redirect("/deliveries");
}

/**
 * Special DO keyed in while AutoCount was down → the real AutoCount DO number. The special DO
 * takes that number, so AutoCount syncs update it from now on; if the sync already brought the
 * DO in as a separate card, that card is merged into it (see link_special_do in upgrade.sql).
 */
export async function linkSpecialDo(id: string, doNo: string) {
  const { supabase, user, profile } = await requireStaff();
  const no = doNo.trim().toUpperCase();
  if (!branchFromDoNo(no)) throw new Error(`"${doNo}" isn't an AutoCount DO number (e.g. GPD-00045135).`);
  const { data: d } = await supabase.from("delivery_orders").select("do_no, so_id, source, branch, created_by").eq("id", id).single();
  if (!d || d.source !== "special") throw new Error("Special DO not found.");
  if (d.created_by !== user.id && profile.role !== "admin" && !canPlan(profile.branch, d.branch)) throw new Error(notYourBranch(d.branch ?? ""));

  const { error } = await supabase.rpc("link_special_do", { p_special: id, p_do_no: no });
  if (error) throw new Error(error.message);

  await supabase.from("status_events").insert({ so_id: d.so_id, do_id: id, status: "linked", note: `${d.do_no} linked to AutoCount DO ${no}` });
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
  revalidatePath("/orders/[id]", "page");
}

/** Office keys in a DO's points (e.g. the address couldn't be found). null = go back to the distance rule. */
export async function setPoints(doId: string, points: number | null) {
  const { supabase } = await requireStaff();
  if (points != null && (!Number.isInteger(points) || points < 0 || points > 99)) throw new Error("Points must be 0–99.");
  const { data: before } = await supabase.from("delivery_orders").select("so_id, points").eq("id", doId).single();
  const { error } = await supabase
    .from("delivery_orders")
    .update(points == null ? { points: null, points_manual: false, geo_status: null } : { points, points_manual: true })
    .eq("id", doId);
  if (error) throw new Error(error.message);
  let now = points;
  if (points == null) {
    await updateDistances(supabase, [doId], true);
    now = (await supabase.from("delivery_orders").select("points").eq("id", doId).single()).data?.points ?? null;
  }
  const pts = (n: number | null | undefined) => (n == null ? "none" : String(n));
  await supabase.from("status_events").insert({
    so_id: before?.so_id,
    do_id: doId,
    status: "points",
    note: `Points ${pts(before?.points)} → ${pts(now)}${points == null ? " (back to the distance rule)" : ""}`,
  });
  revalidatePath("/drivers");
  revalidatePath("/deliveries");
  revalidatePath("/driver");
}

/**
 * Office types an address Google can find (when the delivery address can't be found).
 * Distance and points are worked out from it, and the driver's Waze/Maps go there.
 * null = back to the delivery address. Replaces keyed-in points.
 */
export async function setMapAddress(doId: string, address: string | null) {
  const { supabase } = await requireStaff();
  if (!mapsEnabled()) throw new Error("GOOGLE_MAPS_API_KEY is not set on the server.");
  const { error } = await supabase
    .from("delivery_orders")
    .update({ map_address: address?.trim() || null, points: null, points_manual: false, geo_status: null })
    .eq("id", doId);
  if (error) throw new Error(error.message);
  await updateDistances(supabase, [doId], true);
  const { data } = await supabase.from("delivery_orders").select("points, geo_status").eq("id", doId).single();
  revalidatePath("/drivers");
  revalidatePath("/deliveries");
  revalidatePath("/driver");
  return { found: data?.points != null, status: (data?.geo_status ?? null) as string | null };
}

/** Works out distance + points for DOs that don't have points yet (e.g. after adding a store address). */
export async function calculateMissingPoints(doIds: string[]) {
  const { supabase } = await requireStaff();
  if (!mapsEnabled()) throw new Error("GOOGLE_MAPS_API_KEY is not set on the server.");
  const d = await updateDistances(supabase, doIds.slice(0, 300), true);
  revalidatePath("/drivers");
  revalidatePath("/driver");
  return d;
}

export async function assignDriver(formData: FormData) {
  const { supabase, profile } = await requireStaff();
  const doId = String(formData.get("do_id"));
  // "oc" = O/C: the customer collects, so no driver. Any other pick makes it a delivery.
  const oc = formData.get("driver_id") === "oc";
  const driverId = oc ? null : String(formData.get("driver_id") || "") || null;
  const date = String(formData.get("delivery_date") || "") || undefined;

  const { data: current } = await supabase.from("delivery_orders").select("so_id, status, branch").eq("id", doId).single();
  if (!current) return;
  if (!canPlan(profile.branch, current.branch)) throw new Error(notYourBranch(current.branch));

  let status: DoStatus = current.status;
  if (["pending", "assigned", "failed"].includes(current.status)) status = driverId ? "assigned" : "pending";

  await supabase
    .from("delivery_orders")
    .update({ driver_id: driverId, status, failed_reason: null, own_collection: oc, ...(date ? { delivery_date: date } : {}) })
    .eq("id", doId);

  let driverName = "nobody";
  if (driverId) {
    const { data: d } = await supabase.from("profiles").select("full_name, lorry_no").eq("id", driverId).single();
    driverName = d ? driverLabel(d) : "driver";
  }
  await supabase.from("status_events").insert({
    so_id: current.so_id,
    do_id: doId,
    status,
    note: oc ? "Marked O/C (customer collects)" : driverId ? `Assigned to ${driverName}` : "Unassigned",
  });

  revalidatePath("/deliveries");
  revalidatePath("/orders/[id]", "page"); // a DO can belong to several SOs
}

/**
 * Moves DOs to another delivery day (e.g. tomorrow). The driver stays on them.
 * DOs already on the road or delivered, or delivered by another branch, are skipped.
 */
export async function moveToDate(doIds: string[], date: string) {
  const { supabase, profile } = await requireStaff();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a date.");
  if (date < todayMY()) throw new Error("Deliveries can't be moved to a past date.");

  const { data } = await supabase
    .from("delivery_orders")
    .select("id, so_id, status, driver_id, delivery_date, branch")
    .in("id", doIds.slice(0, 200));
  const rows = (data ?? []).filter(
    (d) => ["pending", "assigned", "failed"].includes(d.status) && canPlan(profile.branch, d.branch) && d.delivery_date !== date
  );

  for (const withDriver of [true, false]) {
    const ids = rows.filter((d) => !!d.driver_id === withDriver).map((d) => d.id);
    if (!ids.length) continue;
    const { error } = await supabase
      .from("delivery_orders")
      .update({ delivery_date: date, status: withDriver ? "assigned" : "pending", failed_reason: null })
      .in("id", ids);
    if (error) throw new Error(error.message);
  }
  if (rows.length) {
    await supabase.from("status_events").insert(
      rows.map((d) => ({
        so_id: d.so_id,
        do_id: d.id,
        status: d.driver_id ? "assigned" : "pending",
        note: `Moved from ${fmtDate(d.delivery_date)} to ${fmtDate(date)}`,
      }))
    );
  }

  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
  revalidatePath("/orders/[id]", "page");
  return { moved: rows.length, skipped: doIds.length - rows.length };
}

/**
 * Failed DO goes out again: back to Assigned (same driver) or Unassigned, from today at the
 * earliest. The failed attempt stays in delivery_attempts and keeps its points. Same day and
 * driver = a new trip, so the trip rule doesn't merge it with the failed one.
 */
export async function redeliver(doId: string) {
  const { supabase, profile } = await requireStaff();
  const { data: d } = await supabase
    .from("delivery_orders")
    .select("so_id, status, branch, driver_id, delivery_date, trip_no")
    .eq("id", doId)
    .single();
  if (!d) throw new Error("DO not found.");
  if (d.status !== "failed") throw new Error("Only failed DOs can be redelivered.");
  if (!canPlan(profile.branch, d.branch)) throw new Error(notYourBranch(d.branch ?? ""));

  const today = todayMY();
  const date = d.delivery_date < today ? today : d.delivery_date;
  let trip = 1;
  if (d.driver_id && date === d.delivery_date) {
    const { data: last } = await supabase
      .from("delivery_orders")
      .select("trip_no")
      .eq("driver_id", d.driver_id)
      .eq("delivery_date", date)
      .order("trip_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    trip = (last?.trip_no ?? 0) + 1;
  }
  const status: DoStatus = d.driver_id ? "assigned" : "pending";
  const { error } = await supabase
    .from("delivery_orders")
    .update({ status, failed_reason: null, delivery_date: date, trip_no: trip, trip_seq: 0 })
    .eq("id", doId);
  if (error) throw new Error(error.message);

  await supabase.from("status_events").insert({
    so_id: d.so_id,
    do_id: doId,
    status,
    note: `Redeliver on ${fmtDate(date)}`,
  });
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
  revalidatePath("/orders/[id]", "page");
}

/**
 * O/C: the customer collected at the store. Counts as delivered (no driver, so no commission).
 * `at` = when ("2026-10-29T15:30", Malaysia time); null = now. collected = false undoes it.
 */
export async function setCollected(doId: string, collected: boolean, at: string | null = null) {
  const { supabase, profile } = await requireStaff();
  const { data: d } = await supabase.from("delivery_orders").select("so_id, status, branch, is_oc").eq("id", doId).single();
  if (!d) throw new Error("DO not found.");
  if (!d.is_oc) throw new Error("Only O/C DOs can be marked collected.");
  if (!canPlan(profile.branch, d.branch)) throw new Error(notYourBranch(d.branch ?? ""));

  let when: string | null = null;
  if (collected && at) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) throw new Error("Pick when it was collected.");
    when = new Date(`${at}:00+08:00`).toISOString();
    if (when > new Date().toISOString()) throw new Error("Collection time can't be in the future.");
  }

  const update = collected ? { status: "delivered", failed_reason: null } : { status: "pending", delivered_at: null };
  const { error } = await supabase.from("delivery_orders").update(update).eq("id", doId);
  if (error) throw new Error(error.message);
  // The database stamps delivered_at with now(); a picked time replaces it afterwards.
  if (when) await supabase.from("delivery_orders").update({ delivered_at: when }).eq("id", doId);

  await supabase.from("status_events").insert({
    so_id: d.so_id,
    do_id: doId,
    status: collected ? "delivered" : "pending",
    note: collected ? "Collected by customer (O/C)" : "O/C collection undone",
  });
  revalidatePath("/deliveries");
  revalidatePath("/orders/[id]", "page");
}

/** Optional estimated delivery window for a DO (e.g. 1–3pm). null = no estimate. */
export async function setTimeSlot(doId: string, slot: string | null) {
  const { supabase, profile } = await requireStaff();
  if (slot != null && !(slot in TIME_SLOTS)) throw new Error("Pick a time slot.");
  const { data: d } = await supabase.from("delivery_orders").select("branch").eq("id", doId).single();
  if (!d) throw new Error("DO not found.");
  if (!canPlan(profile.branch, d.branch)) throw new Error(notYourBranch(d.branch ?? ""));
  const { error } = await supabase.from("delivery_orders").update({ time_slot: slot }).eq("id", doId);
  if (error) throw new Error(error.message);
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
  revalidatePath("/orders/[id]", "page");
}
