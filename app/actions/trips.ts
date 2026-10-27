"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { bestRoute } from "@/lib/geo";
import { branchName, canPlan, storeAddress } from "@/lib/branches";
import type { DoStatus } from "@/lib/types";
import { notYourBranch } from "./_shared";

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
