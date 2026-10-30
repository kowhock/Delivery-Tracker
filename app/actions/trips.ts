"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { bestRoute } from "@/lib/geo";
import { branchName, canPlan, storeAddress } from "@/lib/branches";
import type { DoStatus } from "@/lib/types";
import { parseTime, todayMY } from "@/lib/format";
import { nextTrip, notYourBranch } from "./_shared";

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
    .select("so_id, status, driver_id, delivery_date, trip_no, trip_seq, branch, helper_branch")
    .eq("id", doId)
    .single();
  if (!current) throw new Error("Delivery order not found");
  if (!canPlan(profile.branch, current.branch, current.helper_branch)) throw new Error(notYourBranch(current.branch));
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
      .select("id, so_id, do_no, status, branch, helper_branch, address, map_address, geo_input, geo_lat, geo_lng, trip_seq")
      .eq("driver_id", lane.driverId)
      .eq("delivery_date", lane.date)
      .eq("trip_no", lane.tripNo)
      .eq("cancelled", false)
      .order("trip_seq"),
  ]);
  const stops = rows ?? [];
  const other = stops.find((d) => !canPlan(profile.branch, d.branch, d.helper_branch));
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

// ---------- Trip form: deliveries the driver didn't mark in the app ----

/**
 * A DO typed into an empty box on the daily trip form. It must already be in the system: it
 * becomes delivered by this driver on that day at "time back", in their last trip of the day,
 * with the typed points (keyed in), so it counts in the daily and monthly totals.
 * Saving again (same driver) corrects the times or points.
 */
export async function recordTripFormDo(input: { driverId: string; date: string; doNo: string; timeIn: string; timeBack: string; points: string }) {
  const { supabase, profile } = await requireStaff();
  const doNo = input.doNo.trim().toUpperCase();
  if (!doNo) throw new Error("Type the DO number.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Invalid date");
  if (input.date > todayMY()) throw new Error("Deliveries can't be recorded for a future day.");
  const timeBack = parseTime(input.timeBack);
  if (!timeBack) throw new Error("Type the time back, e.g. 14:30 or 2.30pm.");
  const timeIn = input.timeIn.trim() ? parseTime(input.timeIn) : null;
  if (input.timeIn.trim() && !timeIn) throw new Error("Time in should look like 10:15 or 10.15am.");
  if (timeIn && timeIn > timeBack) throw new Error("Time in is after time back.");
  const points = input.points.trim() === "" ? null : Number(input.points);
  if (points != null && (!Number.isInteger(points) || points < 0 || points > 99)) throw new Error("Points must be a whole number from 0 to 99.");

  const { data: driver } = await supabase.from("profiles").select("full_name, role").eq("id", input.driverId).single();
  if (!driver || driver.role !== "driver") throw new Error("Driver not found");

  const { data: d } = await supabase
    .from("delivery_orders")
    .select("id, so_id, status, driver_id, delivery_date, branch, helper_branch, cancelled")
    .eq("do_no", doNo)
    .maybeSingle();
  if (!d) throw new Error(`${doNo} isn't in the system — check the DO number.`);
  if (!canPlan(profile.branch, d.branch, d.helper_branch)) throw new Error(notYourBranch(d.branch ?? ""));
  if (d.cancelled) throw new Error(`${doNo} is cancelled in AutoCount.`);
  if (d.status === "delivered" && d.driver_id !== input.driverId) throw new Error(`${doNo} was already delivered by another driver.`);

  const at = (t: string) => `${input.date}T${t}:00+08:00`;
  const newLane = d.driver_id !== input.driverId || d.delivery_date !== input.date;
  const { error } = await supabase
    .from("delivery_orders")
    .update({
      driver_id: input.driverId,
      delivery_date: input.date,
      status: "delivered",
      failed_reason: null,
      delivered_at: at(timeBack), // kept for staff by guard_delivery_order (drivers always get the server's clock)
      ...(newLane ? { trip_no: Math.max(1, (await nextTrip(supabase, input.driverId, input.date, d.id)) - 1), trip_seq: 99 } : {}),
      ...(points != null ? { points, points_manual: true } : {}),
    })
    .eq("id", d.id);
  if (error) throw new Error(error.message);

  // Time in is read from the latest "out_for_delivery" event.
  if (timeIn) await supabase.from("status_events").insert({ so_id: d.so_id, do_id: d.id, status: "out_for_delivery", note: "Time in from trip form", created_at: at(timeIn) });
  await supabase.from("status_events").insert({
    so_id: d.so_id,
    do_id: d.id,
    status: "delivered",
    note: `${TRIP_FORM_NOTE} by ${profile.full_name}: ${driver.full_name}, ${input.date} ${timeBack}${points != null ? `, ${points} pts` : ""}`,
  });

  revalidatePath("/trip-form");
  revalidatePath("/drivers");
  revalidatePath("/deliveries");
  revalidatePath("/driver");
  revalidatePath("/orders/[id]", "page");
}

/** The note recordTripFormDo leaves on the DO; marks deliveries that can be undone from the trip form. */
const TRIP_FORM_NOTE = "Recorded from trip form";

/** DOs whose delivery was recorded on the trip form (their latest "delivered" event says so). */
export async function fromTripForm(doIds: string[]): Promise<string[]> {
  const { supabase } = await requireStaff();
  const latest = new Map<string, { at: string; note: string }>();
  for (let i = 0; i < doIds.length; i += 200) {
    const { data } = await supabase.from("status_events").select("do_id, created_at, note").in("do_id", doIds.slice(i, i + 200)).eq("status", "delivered");
    for (const e of data ?? []) if (e.created_at > (latest.get(e.do_id)?.at ?? "")) latest.set(e.do_id, { at: e.created_at, note: e.note ?? "" });
  }
  return [...latest].filter(([, e]) => e.note.startsWith(TRIP_FORM_NOTE)).map(([id]) => id);
}

/** Undoes a trip form save: the DO goes back to Unassigned (no driver, not delivered). */
export async function undoTripFormDo(doId: string) {
  const { supabase, profile } = await requireStaff();
  const { data: d } = await supabase.from("delivery_orders").select("so_id, do_no, status, branch, helper_branch").eq("id", doId).single();
  if (!d) throw new Error("DO not found.");
  if (!canPlan(profile.branch, d.branch, d.helper_branch)) throw new Error(notYourBranch(d.branch ?? ""));
  if (d.status !== "delivered" || !(await fromTripForm([doId])).length) throw new Error(`${d.do_no} wasn't recorded from the trip form, so it can't be undone here.`);

  const { error } = await supabase
    .from("delivery_orders")
    .update({ status: "pending", driver_id: null, delivered_at: null, trip_no: 1, trip_seq: 0 })
    .eq("id", doId);
  if (error) throw new Error(error.message);
  await supabase.from("status_events").insert({ so_id: d.so_id, do_id: doId, status: "pending", note: `Trip form entry undone by ${profile.full_name} (back to Unassigned)` });

  revalidatePath("/trip-form");
  revalidatePath("/drivers");
  revalidatePath("/deliveries");
  revalidatePath("/driver");
  revalidatePath("/orders/[id]", "page");
}
