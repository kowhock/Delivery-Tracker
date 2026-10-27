import { describe, expect, it } from "vitest";
import { commissionForDay, dayTotals, EXTRA_STOP_POINTS, pointsForKm, sumDays, withTripPoints } from "./commission";

describe("pointsForKm", () => {
  it("gives far points only when the distance is over FAR_KM", () => {
    expect(pointsForKm(5)).toBe(2);
    expect(pointsForKm(20)).toBe(2);
    expect(pointsForKm(20.1)).toBe(3);
  });
});

describe("commissionForDay", () => {
  it("pays nothing below the target, then RM 5 per point from the target on", () => {
    expect(commissionForDay(0)).toBe(0);
    expect(commissionForDay(9)).toBe(0);
    expect(commissionForDay(10)).toBe(5);
    expect(commissionForDay(11)).toBe(10);
    expect(commissionForDay(15)).toBe(30);
  });
});

const row = (
  id: string,
  points: number | null,
  o: Partial<{ trip_no: number; points_manual: boolean; driver_id: string | null }> = {},
) => ({
  id,
  driver_id: "drv1",
  delivery_date: "2026-10-27",
  trip_no: 1,
  points,
  points_manual: false,
  ...o,
});

describe("withTripPoints", () => {
  it("keeps full points for the best DO in a trip and cuts the others to extra-stop points", () => {
    const out = withTripPoints([row("a", 2), row("b", 3), row("c", 2)]);
    expect(out.map((r) => [r.id, r.points, r.extraStop])).toEqual([
      ["a", EXTRA_STOP_POINTS, true],
      ["b", 3, false],
      ["c", EXTRA_STOP_POINTS, true],
    ]);
  });

  it("on a tie, the first DO keeps its full points", () => {
    const out = withTripPoints([row("a", 3), row("b", 3)]);
    expect(out.map((r) => r.points)).toEqual([3, EXTRA_STOP_POINTS]);
  });

  it("treats each trip separately", () => {
    const out = withTripPoints([row("a", 3, { trip_no: 1 }), row("b", 2, { trip_no: 2 })]);
    expect(out.map((r) => r.points)).toEqual([3, 2]);
  });

  it("never changes keyed-in points, missing points or DOs without a driver", () => {
    const out = withTripPoints([row("a", 3), row("m", 5, { points_manual: true }), row("n", null), row("x", 2, { driver_id: null })]);
    expect(out.map((r) => [r.points, r.extraStop])).toEqual([
      [3, false],
      [5, false],
      [null, false],
      [2, false],
    ]);
  });

  it("does not mark a 1-point stop as cut", () => {
    const out = withTripPoints([row("a", 3), row("b", 1)]);
    expect(out[1]).toMatchObject({ points: 1, extraStop: false });
  });
});

describe("dayTotals + sumDays", () => {
  it("groups by the Malaysian day and works out commission per day", () => {
    const days = dayTotals([
      { delivered_at: "2026-10-26T17:30:00Z", points: 6 }, // 01:30 on the 27th in Malaysia
      { delivered_at: "2026-10-27T03:00:00Z", points: 5 },
      { delivered_at: "2026-10-27T05:00:00Z", points: null },
      { delivered_at: "2026-10-28T03:00:00Z", points: 9 },
      { delivered_at: null, points: 3 },
    ]);
    expect(Object.fromEntries(days)).toEqual({
      "2026-10-27": { delivered: 3, points: 11, missingPoints: 1 },
      "2026-10-28": { delivered: 1, points: 9, missingPoints: 0 },
    });
    // 11 points → RM 10 on the 27th; 9 points → RM 0 on the 28th (not RM 50 for 20 points combined)
    expect(sumDays(days)).toEqual({ delivered: 4, points: 20, missingPoints: 1, rm: 10 });
  });
});
