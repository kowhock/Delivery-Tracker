import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeliveryOrder } from "./types";

/**
 * When the driver tapped Start on each DO (the last time, if started more than once).
 * It isn't stored on the DO, so it's read from the "out_for_delivery" status events.
 */
export async function startedTimes(supabase: SupabaseClient, doIds: string[]): Promise<Map<string, string>> {
  const started = new Map<string, string>();
  for (let i = 0; i < doIds.length; i += 200) {
    const { data: ev } = await supabase
      .from("status_events")
      .select("do_id, created_at")
      .in("do_id", doIds.slice(i, i + 200))
      .eq("status", "out_for_delivery");
    for (const e of ev ?? []) if (e.created_at > (started.get(e.do_id) ?? "")) started.set(e.do_id, e.created_at);
  }
  return started;
}

/** Fills in `started_at` on DOs that are out for delivery or delivered. */
export async function withStartedAt<T extends Pick<DeliveryOrder, "id" | "status">>(supabase: SupabaseClient, jobs: T[]) {
  const ids = jobs.filter((j) => j.status === "out_for_delivery" || j.status === "delivered").map((j) => j.id);
  const started = ids.length ? await startedTimes(supabase, ids) : new Map<string, string>();
  return jobs.map((j) => ({ ...j, started_at: started.get(j.id) ?? null }));
}
