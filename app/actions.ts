"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSession, requireAdmin, requireStaff } from "@/lib/auth";
import { driverLabel, fmtDate, todayMY } from "@/lib/format";
import { bestRoute, mapsEnabled, updateDistances } from "@/lib/geo";
import { sendDeliveredNotice, waApiEnabled } from "@/lib/whatsapp-api";
import { branchName, canPlan, deliveredOrSoldBy, lockedBranch, storeAddress } from "@/lib/branches";
import { TIME_SLOTS, TODO_LABEL, type DoItem, type DoStatus, type OutstandingTodo, type SalesOrder, type StatusEvent } from "@/lib/types";

// ---------- Auth ------------------------------------------------------

/** Username accounts are Supabase users with the email "<username>@khdelivery.my" (never emailed). */
const USERNAME_DOMAIN = "khdelivery.my";

export async function signIn(_prev: { error?: string } | undefined, formData: FormData) {
  const supabase = await createClient();
  const login = String(formData.get("login")).trim().toLowerCase();
  const { error } = await supabase.auth.signInWithPassword({
    email: login.includes("@") ? login : `${login}@${USERNAME_DOMAIN}`,
    password: String(formData.get("password")),
  });
  if (error) return { error: "Wrong username or password." };
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// ---------- AutoCount import -----------------------------------------

// ---------- Sales order preview ---------------------------------------

export type SoPreview = { so: SalesOrder; items: DoItem[] };

/** An SO's header and items for the popup on Deliveries / Driver status (dispatchers can't open the SO page). */
export async function getSoPreview(soId: string): Promise<SoPreview | null> {
  const { supabase, profile } = await requireStaff();
  const [{ data: so }, { data: items }] = await Promise.all([
    supabase.from("sales_orders").select("*").eq("id", soId).single<SalesOrder>(),
    supabase.from("so_items").select("id, item_code, description, uom, qty").eq("so_id", soId).order("line_no"),
  ]);
  if (!so) return null;
  // Same rule as the SO page: dispatchers see their branch's SOs, or SOs on a DO their branch delivers or sold.
  const locked = lockedBranch(profile);
  if (locked && so.branch !== locked) {
    const { data: dos } = await supabase
      .from("delivery_orders")
      .select("id, do_sales_orders!inner(so_id)")
      .eq("do_sales_orders.so_id", soId)
      .or(deliveredOrSoldBy(locked))
      .limit(1);
    if (!dos?.length) return null;
  }
  return { so, items: (items ?? []) as DoItem[] };
}

/** A DO's item lines, for the DO popup on Deliveries. */
export async function getDoItems(doId: string): Promise<DoItem[]> {
  const { supabase } = await requireStaff();
  const { data, error } = await supabase.from("do_items").select("id, item_code, description, uom, qty").eq("do_id", doId);
  if (error) throw new Error(error.message);
  return (data ?? []) as DoItem[];
}

/** A signed link (valid 1 hour) to a DO's proof-of-delivery photo, for the DO popup. null = no photo. */
export async function getPodPhotoUrl(doId: string): Promise<string | null> {
  const { supabase } = await requireStaff();
  const { data: d } = await supabase.from("delivery_orders").select("pod_photo_path").eq("id", doId).single();
  if (!d?.pod_photo_path) return null;
  const { data } = await supabase.storage.from("pod").createSignedUrl(d.pod_photo_path, 3600);
  return data?.signedUrl ?? null;
}

/** Who changed a DO and when (newest first), for the DO popup. Admins only. */
export async function getDoHistory(doId: string): Promise<StatusEvent[]> {
  const { supabase, profile } = await requireStaff();
  if (profile.role !== "admin") throw new Error("Only admins can see a DO's history.");
  const { data, error } = await supabase
    .from("status_events")
    .select("id, status, note, created_at, do_id, actor:profiles!status_events_actor_id_fkey(full_name)")
    .eq("do_id", doId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as StatusEvent[];
}

// ---------- Outstanding DO work ---------------------------------------

/** Flags a DO that still needs a CN / DO edit / DR etc. in AutoCount. */
export async function addOutstanding(formData: FormData): Promise<{ error?: string }> {
  const { supabase } = await requireStaff();
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const todo = get("todo") as OutstandingTodo;
  if (!(todo in TODO_LABEL)) return { error: "Choose a to-do." };
  if (!get("reason")) return { error: "Key in a reason." };
  if (todo === "other" && !get("todo_other")) return { error: "Say what the other to-do is." };
  const { error } = await supabase.from("do_outstanding").insert({
    do_id: get("do_id"),
    reason: get("reason"),
    todo,
    todo_other: todo === "other" ? get("todo_other") : null,
    description: get("description") || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/deliveries");
  revalidatePath("/outstanding");
  return {};
}

export async function clearOutstanding(id: string) {
  const { supabase, user } = await requireStaff();
  const { error } = await supabase
    .from("do_outstanding")
    .update({ cleared_at: new Date().toISOString(), cleared_by: user.id })
    .eq("id", id)
    .is("cleared_at", null);
  if (error) throw new Error(error.message);
  revalidatePath("/deliveries");
  revalidatePath("/outstanding");
}

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
      branch: lockedBranch(profile) ?? get("branch"), // dispatchers always create for their own branch
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
      branch: lockedBranch(profile) ?? get("branch"),
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

const notYourBranch = (branch: string) => `${branch} branch delivers this DO — only ${branch} can choose its driver or date.`;

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

// ---------- Trip planning (Driver status page) -----------------------

/**
 * Drops a DO into a driver's trip and saves the stop order of that trip.
 * `orderedIds` is the full order of the target trip after the drop.
 * Only the delivering branch (or staff without a branch) can plan a DO.
 */
export async function moveToTrip(input: {
  doId: string;
  driverId: string;
  date: string;
  tripNo: number;
  orderedIds: string[];
}) {
  const { supabase, profile } = await requireStaff();
  const { doId, driverId, date, tripNo, orderedIds } = input;
  if (!Number.isInteger(tripNo) || tripNo < 1) throw new Error("Invalid trip");

  const { data: driver } = await supabase.from("profiles").select("full_name, role").eq("id", driverId).single();
  if (!driver || driver.role !== "driver") throw new Error("Driver not found");

  const { data: current } = await supabase
    .from("delivery_orders")
    .select("so_id, status, driver_id, delivery_date, trip_no, trip_seq, branch")
    .eq("id", doId)
    .single();
  if (!current) throw new Error("Delivery order not found");
  if (!canPlan(profile.branch, current.branch)) throw new Error(notYourBranch(current.branch));
  if (current.status === "delivered" || current.status === "out_for_delivery") {
    throw new Error("This order is already on the road or delivered and can't be moved.");
  }

  const reassigned = current.driver_id !== driverId || current.delivery_date !== date;
  const laneChanged = reassigned || current.trip_no !== tripNo;
  let status: DoStatus = current.status;
  if (reassigned) status = "assigned";

  const { error } = await supabase
    .from("delivery_orders")
    .update({
      driver_id: driverId,
      delivery_date: date,
      trip_no: tripNo,
      ...(reassigned ? { status, failed_reason: null } : {}),
    })
    .eq("id", doId);
  if (error) throw new Error(error.message);

  // Only rows that really are in this trip get renumbered.
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase
        .from("delivery_orders")
        .update({ trip_seq: i })
        .eq("id", id)
        .eq("driver_id", driverId)
        .eq("delivery_date", date)
        .eq("trip_no", tripNo)
    )
  );

  const stop = orderedIds.indexOf(doId);
  if (laneChanged) {
    await supabase.from("status_events").insert({
      so_id: current.so_id,
      do_id: doId,
      status,
      note: `Planned for ${driver.full_name} · Trip ${tripNo} · ${date}`,
    });
  } else if (stop >= 0 && stop !== current.trip_seq) {
    await supabase.from("status_events").insert({
      so_id: current.so_id,
      do_id: doId,
      status: "trip",
      note: `Moved to stop ${stop + 1} in Trip ${tripNo}`,
    });
  }

  revalidatePath("/drivers");
  revalidatePath("/deliveries");
  revalidatePath("/driver");
  revalidatePath("/orders/[id]", "page"); // a DO can belong to several SOs
}

/**
 * Puts one trip's stops in the shortest driving order, starting and ending at
 * the branch store (the lorry loads there and comes back for the next trip).
 * Stops already on the road or delivered stay first, as they are.
 */
export async function optimiseTrip(lane: { driverId: string; date: string; tripNo: number }) {
  const { supabase, profile } = await requireStaff();
  const [{ data: driver }, { data: rows }] = await Promise.all([
    supabase.from("profiles").select("branch").eq("id", lane.driverId).single(),
    supabase
      .from("delivery_orders")
      .select("id, so_id, do_no, status, branch, address, map_address, geo_input, geo_lat, geo_lng, trip_seq")
      .eq("driver_id", lane.driverId)
      .eq("delivery_date", lane.date)
      .eq("trip_no", lane.tripNo)
      .eq("cancelled", false)
      .order("trip_seq"),
  ]);
  const stops = rows ?? [];
  const other = stops.find((d) => !canPlan(profile.branch, d.branch));
  if (other) throw new Error(notYourBranch(other.branch));

  const started = stops.filter((d) => d.status === "out_for_delivery" || d.status === "delivered");
  const todo = stops.filter((d) => !started.includes(d));
  if (todo.length < 2) throw new Error("Put at least 2 DOs that haven't left yet in this trip first.");

  const branch = driver?.branch ?? todo[0].branch;
  const store = storeAddress(branch);
  if (!store) throw new Error(`No store address for ${branchName(branch) || "this driver's branch"} yet — add it in lib/branches.ts.`);

  const route = await bestRoute(supabase, store, todo);
  const order = [...started.map((d) => d.id), ...route.ids];
  await Promise.all(
    order.map((id, i) => supabase.from("delivery_orders").update({ trip_seq: i }).eq("id", id).eq("trip_no", lane.tripNo))
  );
  const moved = todo.filter((d) => order.indexOf(d.id) !== d.trip_seq);
  if (moved.length) {
    await supabase.from("status_events").insert(
      moved.map((d) => ({
        so_id: d.so_id,
        do_id: d.id,
        status: "trip",
        note: `Trip ${lane.tripNo} put in shortest-route order · now stop ${order.indexOf(d.id) + 1}`,
      }))
    );
  }

  revalidatePath("/drivers");
  revalidatePath("/driver");
  const doNo = new Map(stops.map((d) => [d.id, d.do_no]));
  return {
    km: route.km,
    minutes: route.minutes,
    mapsUrl: route.mapsUrl,
    store: branch,
    notFound: route.notFound.map((id) => doNo.get(id)!),
  };
}

// ---------- Delivery status (drivers + staff) ------------------------

async function logAndRevalidate(supabase: SupabaseClient, doId: string, status: DoStatus, note?: string | null) {
  const { data: d } = await supabase.from("delivery_orders").select("so_id").eq("id", doId).single();
  await supabase.from("status_events").insert({ so_id: d?.so_id, do_id: doId, status, note: note || null });
  revalidatePath("/driver");
  revalidatePath("/deliveries");
  revalidatePath("/orders/[id]", "page");
}

export async function startDelivery(doId: string) {
  const { supabase } = await getSession();
  const { error } = await supabase
    .from("delivery_orders")
    .update({ status: "out_for_delivery", failed_reason: null })
    .eq("id", doId);
  if (error) throw new Error(error.message);
  await logAndRevalidate(supabase, doId, "out_for_delivery");
}

export async function markDelivered(doId: string, photoPath: string | null, note: string) {
  const { supabase } = await getSession();
  const { error } = await supabase
    .from("delivery_orders")
    .update({ status: "delivered", pod_photo_path: photoPath, delivered_at: new Date().toISOString() })
    .eq("id", doId);
  if (error) throw new Error(error.message);
  await notifyDelivered(supabase, doId);
  await logAndRevalidate(supabase, doId, "delivered", note);
}

/** WhatsApps the customer "delivered" + the POD photo from the company number, and records how it went. Never throws. */
async function notifyDelivered(supabase: SupabaseClient, doId: string) {
  if (!waApiEnabled()) return;
  const { data: d } = await supabase
    .from("delivery_orders")
    .select("customer_name, so_no, do_no, contact_phone, pod_photo_path")
    .eq("id", doId)
    .single();
  if (!d) return;
  // Meta downloads the photo when it sends; a day leaves room for its retries.
  const photo = d.pod_photo_path ? (await supabase.storage.from("pod").createSignedUrl(d.pod_photo_path, 86400)).data?.signedUrl ?? null : null;
  const ref = d.so_no ? `${d.so_no} (${d.do_no})` : d.do_no;
  const r = await sendDeliveredNotice(d.contact_phone, { customer_name: d.customer_name, ref }, photo);
  await supabase
    .from("delivery_orders")
    .update(r.ok ? { wa_sent_at: new Date().toISOString(), wa_error: null } : { wa_error: r.error })
    .eq("id", doId);
}

/** Office: send the "delivered" WhatsApp again (e.g. after fixing the phone number). */
export async function resendDeliveredNotice(doId: string) {
  const { supabase } = await requireStaff();
  await notifyDelivered(supabase, doId);
  revalidatePath("/orders/[id]", "page");
}

export async function markFailed(doId: string, reason: string) {
  const { supabase } = await getSession();
  const { error } = await supabase
    .from("delivery_orders")
    .update({ status: "failed", failed_reason: reason })
    .eq("id", doId);
  if (error) throw new Error(error.message);
  await logAndRevalidate(supabase, doId, "failed", reason);
}

// ---------- Lorries ---------------------------------------------------

const notYourLorry = (branch: string) => `This lorry belongs to ${branchName(branch)} — only ${branchName(branch)} can change it.`;

async function lorryForEdit(supabase: SupabaseClient, profile: { branch: string | null }, id: string) {
  const { data: l } = await supabase.from("lorries").select("id, lorry_no, branch, driver_id").eq("id", id).single();
  if (!l) throw new Error("Lorry not found.");
  if (!canPlan(profile.branch, l.branch)) throw new Error(notYourLorry(l.branch));
  return l as { id: string; lorry_no: string; branch: string | null; driver_id: string | null };
}

function revalidateLorries() {
  revalidatePath("/lorries");
  revalidatePath("/drivers");
  revalidatePath("/deliveries");
  revalidatePath("/trip-form");
}

/** Adds a lorry, or (with an id) changes its number / plate / branch. */
export async function saveLorry(formData: FormData): Promise<{ error?: string }> {
  const { supabase, profile } = await requireStaff();
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const id = get("id");
  const lorryNo = get("lorry_no");
  if (!lorryNo) return { error: "Key in the lorry number." };
  const row = {
    lorry_no: lorryNo,
    plate_no: get("plate_no").toUpperCase() || null,
    branch: lockedBranch(profile) ?? (get("branch") || null), // dispatchers only keep their own branch's lorries
  };
  if (id) await lorryForEdit(supabase, profile, id);
  const { data, error } = id
    ? await supabase.from("lorries").update(row).eq("id", id).select("id").single()
    : await supabase.from("lorries").insert(row).select("id").single();
  if (error) return { error: error.code === "23505" ? `Lorry ${lorryNo} already exists.` : error.message };
  await supabase.from("lorry_events").insert({ lorry_id: data.id, note: id ? "Details changed" : "Lorry added" });
  revalidateLorries();
  return {};
}

/** Puts a driver on a lorry (or takes them off with null). A driver drives one lorry, so they leave their old one. */
export async function setLorryDriver(lorryId: string, driverId: string | null) {
  const { supabase, profile } = await requireStaff();
  const lorry = await lorryForEdit(supabase, profile, lorryId);
  if (lorry.driver_id === driverId) return;

  const names = new Map<string, string>();
  const ids = [lorry.driver_id, driverId].filter((x): x is string => !!x);
  if (ids.length) {
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of data ?? []) names.set(p.id, p.full_name);
  }

  if (driverId) {
    const { data: old } = await supabase.from("lorries").select("id").eq("driver_id", driverId).neq("id", lorryId).maybeSingle();
    if (old) {
      const { error } = await supabase.from("lorries").update({ driver_id: null }).eq("id", old.id);
      if (error) throw new Error(error.message);
      await supabase.from("lorry_events").insert({ lorry_id: old.id, note: `${names.get(driverId)} moved to lorry ${lorry.lorry_no}` });
    }
  }
  const { error } = await supabase.from("lorries").update({ driver_id: driverId }).eq("id", lorryId);
  if (error) throw new Error(error.message);
  const note = driverId
    ? lorry.driver_id
      ? `Driver changed: ${names.get(lorry.driver_id)} → ${names.get(driverId)}`
      : `Driver: ${names.get(driverId)}`
    : `${names.get(lorry.driver_id!)} taken off`;
  await supabase.from("lorry_events").insert({ lorry_id: lorryId, note });
  revalidateLorries();
}

/** Books a lorry for maintenance from a day (to a day, if known). */
export async function setMaintenance(formData: FormData): Promise<{ error?: string }> {
  const { supabase, profile } = await requireStaff();
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const from = get("maintenance_from");
  const to = get("maintenance_to") || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return { error: "Pick the day maintenance starts." };
  if (to && to < from) return { error: "The back-in-service day is before the start day." };
  const lorry = await lorryForEdit(supabase, profile, get("id"));
  const note = get("maintenance_note") || null;
  const { error } = await supabase
    .from("lorries")
    .update({ maintenance_from: from, maintenance_to: to, maintenance_note: note })
    .eq("id", lorry.id);
  if (error) return { error: error.message };
  await supabase.from("lorry_events").insert({
    lorry_id: lorry.id,
    note: `Maintenance ${fmtDate(from)}${to ? ` – ${fmtDate(to)}` : " (no return date yet)"}${note ? `: ${note}` : ""}`,
  });
  revalidateLorries();
  return {};
}

export async function endMaintenance(lorryId: string) {
  const { supabase, profile } = await requireStaff();
  const lorry = await lorryForEdit(supabase, profile, lorryId);
  const { error } = await supabase
    .from("lorries")
    .update({ maintenance_from: null, maintenance_to: null, maintenance_note: null })
    .eq("id", lorry.id);
  if (error) throw new Error(error.message);
  await supabase.from("lorry_events").insert({ lorry_id: lorry.id, note: "Back in service" });
  revalidateLorries();
}
