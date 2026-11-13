import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, fmtDate, todayMY } from "./format";

/** How far back the carry-over looks: Unassigned DOs older than this stay on their own day (search still finds them). */
export const ROLL_DAYS = 4;

/**
 * Unassigned DOs left from an earlier day move to today, so they're still in today's Unassigned
 * column and nobody forgets to deliver them. Each day's leftovers roll on again the next day.
 * Only the delivery date moves: the AutoCount DO date (doc_date) stays as it is. O/C, supplier
 * deliveries, cancelled DOs and DOs with a driver are left alone.
 * Runs when staff open Deliveries or Driver status; usually it finds nothing to move.
 */
export async function rollUnassigned(supabase: SupabaseClient): Promise<void> {
  const today = todayMY();
  const { data: old } = await supabase
    .from("delivery_orders")
    .select("id, so_id, delivery_date")
    .eq("status", "pending")
    .is("driver_id", null)
    .eq("cancelled", false)
    .eq("is_oc", false)
    .eq("supplier_delivery", false)
    .gte("delivery_date", addDays(today, -ROLL_DAYS))
    .lt("delivery_date", today)
    .limit(1000);
  if (!old?.length) return;

  // Only rows still Unassigned and still in the past (two pages opening at once don't both move them).
  const { data: moved } = await supabase
    .from("delivery_orders")
    .update({ delivery_date: today })
    .in("id", old.map((d) => d.id))
    .eq("status", "pending")
    .is("driver_id", null)
    .lt("delivery_date", today)
    .select("id");
  if (!moved?.length) return;

  const was = new Map(old.map((d) => [d.id, d]));
  await supabase.from("status_events").insert(
    moved.map(({ id }) => ({
      so_id: was.get(id)?.so_id ?? null,
      do_id: id,
      status: "pending",
      note: `Moved from ${fmtDate(was.get(id)!.delivery_date)} to ${fmtDate(today)} (not assigned yet)`,
    }))
  );
}
