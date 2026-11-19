import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, fmtDate, todayMY } from "./format";

/** How far back the carry-over looks: Unassigned DOs older than this stay on their own day (search still finds them). */
export const ROLL_DAYS = 4;

/** The history notes for these moves are signed by the sync account, not whoever opened the page. */
const ROLL_ACTOR_NAME = "admin-sync";

/**
 * Unassigned DOs left from an earlier day move to today, so they're still in today's Unassigned
 * column and nobody forgets to deliver them. Each day's leftovers roll on again the next day.
 * Only the delivery date moves: the AutoCount DO date (doc_date) stays as it is. Void SDOs, O/C, supplier
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
    .is("voided_at", null) // void SDOs stay on their own day (voiding also sets cancelled; this keeps it explicit)
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
  // No such account (renamed?) → the note falls back to the person who opened the page, as before.
  const { data: bot } = await supabase.from("profiles").select("id").eq("full_name", ROLL_ACTOR_NAME).limit(1).maybeSingle();
  await supabase.from("status_events").insert(
    moved.map(({ id }) => ({
      so_id: was.get(id)?.so_id ?? null,
      do_id: id,
      status: "pending",
      ...(bot ? { actor_id: bot.id } : {}),
      note: `Moved from ${fmtDate(was.get(id)!.delivery_date)} to ${fmtDate(today)} (not assigned yet)`,
    }))
  );
}
