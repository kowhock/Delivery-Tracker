import { describe, expect, it } from "vitest";
import { addDays, dateRange, dayLabel, driverLabel, fmtMoney, isMobile, mapAddress, mapsLinks, normalizePhone, weekRange } from "./format";

describe("normalizePhone", () => {
  it.each([
    ["012-345 6789", "60123456789"],
    ["+6012 3456789", "60123456789"],
    ["12-3456789", "60123456789"],
    ["011-2345 6789", "601123456789"],
    ["03-1234 5678", "60312345678"],
    ["012-3456789 / 03-12345678", "60123456789"],
    ["012-3456789 or 019-8765432", "60123456789"],
  ])("%s → %s", (raw, want) => {
    expect(normalizePhone(raw)).toBe(want);
  });

  it.each([null, undefined, "", "abc", "123"])("returns null for %s", (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });
});

describe("isMobile", () => {
  it("accepts 601x numbers and rejects landlines", () => {
    expect(isMobile("60123456789")).toBe(true);
    expect(isMobile("601123456789")).toBe(true);
    expect(isMobile("60312345678")).toBe(false);
    expect(isMobile(null)).toBe(false);
  });
});

describe("dates", () => {
  it("weekRange runs Monday to Sunday", () => {
    expect(weekRange("2026-10-27")).toEqual(["2026-10-26", "2026-11-01"]); // Tuesday
    expect(weekRange("2026-11-01")).toEqual(["2026-10-26", "2026-11-01"]); // Sunday
    expect(weekRange("2026-10-26")).toEqual(["2026-10-26", "2026-11-01"]); // Monday
  });

  it("dateRange includes both ends and stops at max", () => {
    expect(dateRange("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(dateRange("2026-01-01", "2026-12-31", 3)).toHaveLength(3);
    expect(dateRange("2026-10-05", "2026-10-01")).toEqual([]);
  });

  it("addDays crosses months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("dayLabel names today and tomorrow", () => {
    expect(dayLabel("2026-10-27", "2026-10-27")).toMatch(/^Today · 27 Oct$/);
    expect(dayLabel("2026-10-28", "2026-10-27")).toMatch(/^Tomorrow · 28 Oct$/);
    expect(dayLabel("2026-10-30", "2026-10-27")).toMatch(/^Fri · 30 Oct$/);
  });
});

describe("addresses and labels", () => {
  it("mapAddress prefers the office-typed address unless it's blank", () => {
    expect(mapAddress({ address: "A", map_address: "B" })).toBe("B");
    expect(mapAddress({ address: "A", map_address: "  " })).toBe("A");
    expect(mapAddress({ address: "A" })).toBe("A");
  });

  it("mapsLinks uses coordinates when known, else the encoded address", () => {
    expect(mapsLinks("x", { lat: 1.5, lng: 103.7 }).waze).toBe("https://waze.com/ul?ll=1.5,103.7&navigate=yes");
    expect(mapsLinks("Jalan 1, JB").google).toBe("https://www.google.com/maps/search/?api=1&query=Jalan%201%2C%20JB");
  });

  it("driverLabel adds the lorry number when there is one", () => {
    expect(driverLabel({ full_name: "Azli", lorry_no: "93" })).toBe("Azli · Lorry 93");
    expect(driverLabel({ full_name: "Azli", lorry_no: null })).toBe("Azli");
  });

  it("fmtMoney shows ringgit with two decimals", () => {
    expect(fmtMoney(1234.5)).toBe("RM 1,234.50");
    expect(fmtMoney(null)).toBe("—");
  });
});
