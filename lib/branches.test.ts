import { describe, expect, it } from "vitest";
import { branchFromDoNo, branchFromLocation, branchName, canPlan, deliveredOrSoldBy, lockedBranch, pickBranch } from "./branches";
import { splitDocNos } from "./autocount-rows";

describe("branchFromDoNo", () => {
  it("reads the branch from the DO prefix, ignoring case and spaces", () => {
    expect(branchFromDoNo("GPD-00044524")).toBe("GP");
    expect(branchFromDoNo(" pdd-00045420 ")).toBe("PD");
    expect(branchFromDoNo("XYZ-1")).toBeNull();
  });
});

describe("branchFromLocation", () => {
  it("maps AutoCount locations and agents to branches", () => {
    expect(branchFromLocation("KP")).toBe("KS");
    expect(branchFromLocation(" gps ")).toBe("GP");
  });

  it("falls back to the SO number prefix", () => {
    expect(branchFromLocation(null, "PDS-00012")).toBe("PD");
    expect(branchFromLocation("UNKNOWN", "MSS-1")).toBe("MS");
    expect(branchFromLocation("UNKNOWN")).toBeNull();
  });
});

describe("who sees and plans what", () => {
  it("canPlan: only the delivering branch, unless either side has no branch", () => {
    expect(canPlan("GP", "GP")).toBe(true);
    expect(canPlan("GP", "PD")).toBe(false);
    expect(canPlan(null, "PD")).toBe(true);
    expect(canPlan("GP", null)).toBe(true);
  });

  it("lockedBranch: only dispatchers with a branch are kept to it", () => {
    expect(lockedBranch({ role: "dispatcher", branch: "GP" })).toBe("GP");
    expect(lockedBranch({ role: "dispatcher", branch: null })).toBeNull();
    expect(lockedBranch({ role: "admin", branch: "GP" })).toBeNull();
  });

  it("pickBranch: own branch by default, '' for all", () => {
    expect(pickBranch(undefined, "GP")).toBe("GP");
    expect(pickBranch(undefined, null)).toBe("");
    expect(pickBranch("all", "GP")).toBe("");
    expect(pickBranch("PD", "GP")).toBe("PD");
  });

  it("deliveredOrSoldBy builds the PostgREST filter", () => {
    expect(deliveredOrSoldBy("GP")).toBe("branch.eq.GP,sales_branch.eq.GP");
  });

  it("branchName falls back to the code", () => {
    expect(branchName("KS")).toBe("Kempas");
    expect(branchName("ZZ")).toBe("ZZ");
    expect(branchName(null)).toBe("");
  });
});

describe("splitDocNos", () => {
  it("splits on commas, semicolons and spaces, uppercases and de-duplicates", () => {
    expect(splitDocNos("gpd-1, GPD-1;GPD-2  GPD-3")).toEqual(["GPD-1", "GPD-2", "GPD-3"]);
    expect(splitDocNos(null)).toEqual([]);
  });
});
