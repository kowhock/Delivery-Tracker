import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Failed delivery attempts that earn commission, shaped like delivered DOs so `withTripPoints`
 * and `dayTotals` count them: `id` is the attempt's, `delivered_at` is when it failed, and the
 * points are the DO's own. See delivery_attempts in supabase/schema.sql.
 */
export type FailedAttempt = {
  id: string;
  do_id: string;
  driver_id: string | null;
  lorry_id: string | null;
  delivery_date: string;
  trip_no: number;
  started_at: string | null;
  delivered_at: string;
  failed: true;
  failed_reason: string | null;
  points: number | null;
  points_manual: boolean;
  do_no: string;
  customer_name: string;
  address: string | null;
  map_address: string | null;
};

/** Attempts by these drivers that failed in [fromIso, toIso). */
export async function failedAttempts(supabase: SupabaseClient, driverIds: string[], fromIso: string, toIso: string): Promise<FailedAttempt[]> {
  if (!driverIds.length) return [];
  const { data } = await supabase
    .from("delivery_attempts")
    .select("id, do_id, driver_id, lorry_id, delivery_date, trip_no, started_at, failed_at, failed_reason, do:delivery_orders!inner(do_no, customer_name, address, map_address, points, points_manual, cancelled)")
    .in("driver_id", driverIds)
    .eq("do.cancelled", false)
    .gte("failed_at", fromIso)
    .lt("failed_at", toIso)
    .order("failed_at");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map(({ do: d, failed_at, ...a }: any) => ({
    ...a,
    delivered_at: failed_at,
    failed: true as const,
    points: d.points,
    points_manual: d.points_manual,
    do_no: d.do_no,
    customer_name: d.customer_name,
    address: d.address,
    map_address: d.map_address,
  }));
}
