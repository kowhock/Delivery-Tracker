/**
 * Driver commission rules — change the numbers here.
 * - Each DO is worth points: FAR_POINTS when the store → customer driving
 *   distance is over FAR_KM, else NEAR_POINTS (or what the office keyed in).
 * - In one trip only one DO earns its full points (the one worth most); every
 *   other DO in that trip earns EXTRA_STOP_POINTS. Keyed-in points are kept as keyed.
 * - Reaching POINTS_TARGET points in a day earns RM_PER_POINT, and every point
 *   after that another RM_PER_POINT (9 pts = RM 0, 10 = RM 5, 11 = RM 10, 15 = RM 30).
 */
export const POINTS_TARGET = 10;
export const RM_PER_POINT = 5;
export const FAR_KM = 20;
export const FAR_POINTS = 3;
export const NEAR_POINTS = 2;
export const EXTRA_STOP_POINTS = 1;

export const pointsForKm = (km: number) => (km > FAR_KM ? FAR_POINTS : NEAR_POINTS);

/** RM earned for one day's points. */
export const commissionForDay = (points: number) => Math.max(0, points - POINTS_TARGET + 1) * RM_PER_POINT;

type TripRow = {
  id: string;
  driver_id: string | null;
  delivery_date: string;
  trip_no: number;
  points: number | null;
  points_manual: boolean;
};

/**
 * The points each DO really earns once the trip rule is applied: `points` is
 * replaced, `extraStop` marks DOs cut to EXTRA_STOP_POINTS. Pass the DOs that
 * count (e.g. only delivered ones for commission).
 */
export function withTripPoints<T extends TripRow>(rows: T[]): (T & { extraStop: boolean })[] {
  const full = new Map<string, string>(); // trip → id of the DO that keeps full points
  for (const r of rows) {
    if (r.points_manual || r.points == null || !r.driver_id) continue;
    const trip = `${r.driver_id}|${r.delivery_date}|${r.trip_no}`;
    const best = rows.find((x) => x.id === full.get(trip));
    if (!best || r.points > best.points!) full.set(trip, r.id);
  }
  return rows.map((r) => {
    if (r.points_manual || r.points == null || !r.driver_id) return { ...r, extraStop: false };
    const extraStop = full.get(`${r.driver_id}|${r.delivery_date}|${r.trip_no}`) !== r.id && r.points > EXTRA_STOP_POINTS;
    return { ...r, points: extraStop ? EXTRA_STOP_POINTS : r.points, extraStop };
  });
}

/** Groups delivered DOs by Malaysian calendar day of delivery. */
export function dayTotals(rows: { delivered_at: string | null; points: number | null }[]) {
  const days = new Map<string, { delivered: number; points: number; missingPoints: number }>();
  for (const r of rows) {
    if (!r.delivered_at) continue;
    const day = new Date(r.delivered_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
    const t = days.get(day) ?? { delivered: 0, points: 0, missingPoints: 0 };
    t.delivered += 1;
    if (r.points == null) t.missingPoints += 1;
    else t.points += r.points;
    days.set(day, t);
  }
  return days;
}

/** Totals over several days: commission is worked out per day, then added up. */
export function sumDays(days: Map<string, { delivered: number; points: number; missingPoints: number }>) {
  let delivered = 0, points = 0, missingPoints = 0, rm = 0;
  for (const d of days.values()) {
    delivered += d.delivered;
    points += d.points;
    missingPoints += d.missingPoints;
    rm += commissionForDay(d.points);
  }
  return { delivered, points, missingPoints, rm };
}
