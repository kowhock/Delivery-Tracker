import { describe, expect, it } from "vitest";
import { dayDmy, dmy, monthGrid, monthRange, orderRange } from "./date-range";

describe("date range helpers", () => {
  it("shows day/month/year", () => {
    expect(dmy("2026-11-03")).toBe("03/11/2026");
    expect(dayDmy("2026-11-03")).toBe("Tue 03/11/2026");
  });
  it("lays a month out Monday-first in full weeks", () => {
    const nov = monthGrid(2026, 11); // 1 Nov 2026 is a Sunday
    expect(nov.slice(0, 7)).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(nov.length % 7).toBe(0);
    expect(nov.filter(Boolean)).toHaveLength(30);
    expect(monthGrid(2028, 2).filter(Boolean)).toHaveLength(29); // leap year
  });
  it("orders the two picked days and caps the range at 31 days", () => {
    expect(orderRange("2026-11-20", "2026-11-05")).toEqual(["2026-11-05", "2026-11-20"]);
    expect(orderRange("2026-11-01", "2026-12-25", 31)).toEqual(["2026-11-01", "2026-12-01"]);
    expect(orderRange("2026-11-01", "2027-02-25")).toEqual(["2026-11-01", "2027-02-25"]); // no limit
  });
  it("this month and last month, across a year", () => {
    expect(monthRange("2026-11-03")).toEqual(["2026-11-01", "2026-11-30"]);
    expect(monthRange("2026-01-15", -1)).toEqual(["2025-12-01", "2025-12-31"]);
  });
});
