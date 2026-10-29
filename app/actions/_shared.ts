// Plain helpers shared by the action files. Kept out of the "use server" files,
// where every export would become an action the browser can call.

import type { SupabaseClient } from "@supabase/supabase-js";

export const notYourBranch = (branch: string) => `${branch} branch delivers this DO — only ${branch} can choose its driver or date.`;

/**
 * The trip a newly assigned DO goes into: the one after the driver's last trip that day
 * (Trip 1 has DOs → Trip 2), so it never joins a trip that's already planned or on the road.
 * The office can still drag it back into an earlier trip on Driver status.
 */
export async function nextTrip(supabase: SupabaseClient, driverId: string, date: string, exceptId?: string) {
  let q = supabase.from("delivery_orders").select("trip_no").eq("driver_id", driverId).eq("delivery_date", date).eq("cancelled", false);
  if (exceptId) q = q.neq("id", exceptId);
  const { data } = await q.order("trip_no", { ascending: false }).limit(1).maybeSingle();
  return (data?.trip_no ?? 0) + 1;
}
