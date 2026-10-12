"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSession, requireAdmin, requireStaff } from "@/lib/auth";
import { driverLabel, fmtDate, todayMY } from "@/lib/format";
import { importAcDeliveryOrders, importAcSalesOrders } from "@/lib/autocount";
import { bestRoute, mapsEnabled, updateDistances } from "@/lib/geo";
import type { AcImport, AcImportResult } from "@/lib/autocount-rows";
import { branchName, canPlan, deliveredOrSoldBy, lockedBranch, storeAddress } from "@/lib/branches";
import type { DoItem, DoStatus, SalesOrder } from "@/lib/types";

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

/** Saves an AutoCount SO or DO listing (parsed in the browser from the Excel export). */
export async function importAutoCount(data: AcImport): Promise<AcImportResult> {
  const { supabase } = await requireAdmin();
  const result =
    data.kind === "so"
      ? await importAcSalesOrders(supabase, data.rows)
      : await importAcDeliveryOrders(supabase, data.rows);

  // New / changed delivery addresses → driving distance → driver points.
  if (data.kind === "do") {
    const doNos = [...result.created, ...result.updated];
    const ids: string[] = [];
    for (let i = 0; i < doNos.length; i += 200) {
      const { data: rows } = await supabase.from("delivery_orders").select("id").in("do_no", doNos.slice(i, i + 200));
      ids.push(...(rows ?? []).map((r) => r.id as string));
    }
    if (!mapsEnabled()) {
      result.notes = ["Distances not calculated: GOOGLE_MAPS_API_KEY is not set. Key in points on Driver status."];
    } else {
      const d = await updateDistances(supabase, ids);
      result.notes = [
        `Distance & points worked out for ${d.measured} DOs.` +
          (d.needManual ? ` ${d.needManual} need points keyed in on Driver status (address not found or no store address).` : ""),
      ];
    }
  }
  revalidatePath("/orders");
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  return result;
}

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

/** Office keys in a DO's points (e.g. the address couldn't be found). null = go back to the distance rule. */
export async function setPoints(doId: string, points: number | null) {
  const { supabase } = await requireStaff();
  if (points != null && (!Number.isInteger(points) || points < 0 || points > 99)) throw new Error("Points must be 0–99.");
  const { error } = await supabase
    .from("delivery_orders")
    .update(points == null ? { points: null, points_manual: false, geo_status: null } : { points, points_manual: true })
    .eq("id", doId);
  if (error) throw new Error(error.message);
  if (points == null) await updateDistances(supabase, [doId], true);
  revalidatePath("/drivers");
  revalidatePath("/deliveries");
  revalidatePath("/driver");
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
    .select("so_id, status, driver_id, delivery_date, trip_no, branch")
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

  if (laneChanged) {
    await supabase.from("status_events").insert({
      so_id: current.so_id,
      do_id: doId,
      status,
      note: `Planned for ${driver.full_name} · Trip ${tripNo} · ${date}`,
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
      .select("id, do_no, status, branch, address, geo_input, geo_lat, geo_lng, trip_seq")
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
  await logAndRevalidate(supabase, doId, "delivered", note);
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
