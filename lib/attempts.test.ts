import { describe, expect, it } from "vitest";
import { attemptPoints } from "./attempts";
import { withTripPoints } from "./commission";

describe("attemptPoints", () => {
  it("earns the DO's points by default", () => {
    expect(attemptPoints(null, 3, false)).toEqual({ points: 3, points_manual: false });
    expect(attemptPoints(null, 5, true)).toEqual({ points: 5, points_manual: true });
    expect(attemptPoints(null, null, false)).toEqual({ points: null, points_manual: false });
  });

  it("earns what staff keyed in for the attempt", () => {
    expect(attemptPoints(0, 3, false)).toEqual({ points: 0, points_manual: true });
    expect(attemptPoints(0, null, false)).toEqual({ points: 0, points_manual: true });
    expect(attemptPoints(1, 3, false)).toEqual({ points: 1, points_manual: true });
  });

  it("keyed-in points aren't cut by the trip rule", () => {
    const base = { driver_id: "d1", delivery_date: "2026-11-20", trip_no: 1 };
    const rows = withTripPoints([
      { id: "do", ...base, points: 3, points_manual: false },
      { id: "attempt", ...base, ...attemptPoints(2, 3, false) },
    ]);
    expect(rows.find((r) => r.id === "attempt")!.points).toBe(2);
  });

  it("a zeroed attempt doesn't take the trip's full-points slot", () => {
    const base = { driver_id: "d1", delivery_date: "2026-11-20", trip_no: 1 };
    const rows = withTripPoints([
      { id: "attempt", ...base, ...attemptPoints(0, 3, false) },
      { id: "do", ...base, points: 2, points_manual: false },
    ]);
    expect(rows.find((r) => r.id === "attempt")!.points).toBe(0);
    expect(rows.find((r) => r.id === "do")!.points).toBe(2); // still the full one, not cut to 1
  });

  it("failed then redelivered on another day: only the redelivery counts", () => {
    const rows = withTripPoints([
      { id: "attempt", driver_id: "d1", delivery_date: "2026-11-19", trip_no: 1, ...attemptPoints(0, 3, false) },
      { id: "do", driver_id: "d1", delivery_date: "2026-11-20", trip_no: 1, points: 3, points_manual: false },
    ]);
    expect(rows.reduce((s, r) => s + (r.points ?? 0), 0)).toBe(3);
  });
});
