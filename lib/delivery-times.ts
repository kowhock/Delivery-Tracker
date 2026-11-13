import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeliveryOrder } from "./types";

/**
 * When the driver tapped Start on each DO (the last time, if started more than once).
 * It isn't stored on the DO, so it's read from the "out_for_delivery" status events.
 * A time in the office typed on the trip form wins over the driver's tap.
 */
export async function startedTimes(supabase: SupabaseClient, doIds: string[]): Promise<Map<string, string>> {
  const started = new Map<string, string>();
  const typed = new Map<string, string>();
  for (let i = 0; i < doIds.length; i += 200) {
    const { data: ev } = await supabase
      .from("status_events")
      .select("do_id, created_at, note")
      .in("do_id", doIds.slice(i, i + 200))
      .eq("status", "out_for_delivery");
    for (const e of ev ?? []) {
      const m = e.note === TRIP_FORM_TIME_IN ? typed : started;
      if (e.created_at > (m.get(e.do_id) ?? "")) m.set(e.do_id, e.created_at);
    }
  }
  for (const [id, at] of typed) started.set(id, at);
  return started;
}

/** The note on a time in typed on the trip form (app/actions/trips.ts recordTripFormDo). */
export const TRIP_FORM_TIME_IN = "Time in from trip form";

/** Fills in `started_at` on DOs that are out for delivery or delivered. */
export async function withStartedAt<T extends Pick<DeliveryOrder, "id" | "status">>(supabase: SupabaseClient, jobs: T[]) {
  const ids = jobs.filter((j) => j.status === "out_for_delivery" || j.status === "delivered").map((j) => j.id);
  const started = ids.length ? await startedTimes(supabase, ids) : new Map<string, string>();
  return jobs.map((j) => ({ ...j, started_at: started.get(j.id) ?? null }));
}
