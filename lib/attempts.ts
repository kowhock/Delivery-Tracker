import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Failed delivery attempts that earn commission, shaped like delivered DOs so `withTripPoints`
 * and `dayTotals` count them: `id` is the attempt's, `delivered_at` is when it failed, and the
 * points are the DO's own — or the attempt's own when staff keyed them in on the trip form (`attempt_points`).
 * See delivery_attempts in supabase/schema.sql.
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
  /** Points staff keyed in for this attempt on the trip form; null = it earns the DO's points. */
  attempt_points: number | null;
  do_no: string;
  customer_name: string;
  address: string | null;
  map_address: string | null;
  /** The DO's delivering branch. */
  branch: string | null;
};

/**
 * What one failed attempt earns: the points keyed in for it on the trip form, else the DO's points.
 * Keyed-in points count as manual, so the one-full-DO-per-trip rule keeps them as keyed (like a DO's
 * keyed-in points) and a 0 never takes the trip's full-points slot from a DO that really earns.
 */
export function attemptPoints(own: number | null, doPoints: number | null, doPointsManual: boolean): { points: number | null; points_manual: boolean } {
  return own != null ? { points: own, points_manual: true } : { points: doPoints, points_manual: doPointsManual };
}

/** Attempts by these drivers on DOs assigned to days `from`..`to` (YYYY-MM-DD, inclusive). */
export async function failedAttempts(supabase: SupabaseClient, driverIds: string[], from: string, to: string): Promise<FailedAttempt[]> {
  if (!driverIds.length) return [];
  const { data } = await supabase
    .from("delivery_attempts")
    .select("id, do_id, driver_id, lorry_id, delivery_date, trip_no, started_at, failed_at, failed_reason, points, do:delivery_orders!inner(do_no, customer_name, address, map_address, points, points_manual, cancelled, branch)")
    .in("driver_id", driverIds)
    .eq("do.cancelled", false)
    .gte("delivery_date", from)
    .lte("delivery_date", to)
    .order("failed_at");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map(({ do: d, failed_at, points, ...a }: any) => ({
    ...a,
    delivered_at: failed_at,
    failed: true as const,
    attempt_points: points ?? null,
    ...attemptPoints(points ?? null, d.points, d.points_manual),
    do_no: d.do_no,
    customer_name: d.customer_name,
    address: d.address,
    map_address: d.map_address,
    branch: d.branch ?? null,
  }));
}
