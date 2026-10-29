import { describe, expect, it } from "vitest";
import { branchFromDoNo, branchFromLocation, branchName, branchToSave, canPlan, deliveredOrSoldBy, lockedBranches, pageBranch, pickBranch, userBranches } from "./branches";
import { splitDocNos } from "./autocount-rows";

describe("branchFromDoNo", () => {
  it("reads the branch from the DO prefix, ignoring case and spaces", () => {
    expect(branchFromDoNo("GPD-00044524")).toBe("GP");
    expect(branchFromDoNo(" pdd-00045420 ")).toBe("PD");
    expect(branchFromDoNo("SND-00001234")).toBe("SL");
    expect(branchFromDoNo("XYZ-1")).toBeNull();
  });

  it("reads inter-company invoice numbers (M-PT-…) as the branch's DO", () => {
    expect(branchFromDoNo("M-PT-00000483")).toBe("PT");
    expect(branchFromDoNo(" m-ks-00003887 ")).toBe("KS");
    expect(branchFromDoNo("M-SN-00000005")).toBe("SL");
    expect(branchFromDoNo("M-XX-1")).toBeNull();
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
    expect(canPlan("KS,MS", "MS")).toBe(true);
    expect(canPlan("KS,MS", "GP")).toBe(false);
  });

  it("userBranches: one code or several, comma-separated", () => {
    expect(userBranches("KS")).toEqual(["KS"]);
    expect(userBranches(" ks, MS ,")).toEqual(["KS", "MS"]);
    expect(userBranches(null)).toEqual([]);
  });

  it("lockedBranches: only dispatchers with branches are kept to them", () => {
    expect(lockedBranches({ role: "dispatcher", branch: "GP" })).toEqual(["GP"]);
    expect(lockedBranches({ role: "dispatcher", branch: "KS,MS" })).toEqual(["KS", "MS"]);
    expect(lockedBranches({ role: "dispatcher", branch: null })).toBeNull();
    expect(lockedBranches({ role: "admin", branch: "GP" })).toBeNull();
  });

  it("pickBranch: own branch by default, '' for all", () => {
    expect(pickBranch(undefined, "GP")).toBe("GP");
    expect(pickBranch(undefined, null)).toBe("");
    expect(pickBranch(undefined, "KS,MS")).toBe("");
    expect(pickBranch("all", "GP")).toBe("");
    expect(pickBranch("PD", "GP")).toBe("PD");
  });

  it("pageBranch: dispatchers stay inside their branches", () => {
    const one = { role: "dispatcher", branch: "GP" };
    const two = { role: "dispatcher", branch: "KS,MS" };
    expect(pageBranch("PD", one)).toBe("GP");
    expect(pageBranch(undefined, two)).toBe("");
    expect(pageBranch("MS", two)).toBe("MS");
    expect(pageBranch("GP", two)).toBe("");
    expect(pageBranch("PD", { role: "admin", branch: "GP" })).toBe("PD");
  });

  it("branchToSave: dispatchers only save under one of their branches", () => {
    expect(branchToSave({ role: "dispatcher", branch: "KS,MS" }, "MS")).toBe("MS");
    expect(branchToSave({ role: "dispatcher", branch: "KS,MS" }, "GP")).toBe("KS");
    expect(branchToSave({ role: "admin", branch: "KS" }, "GP")).toBe("GP");
  });

  it("deliveredOrSoldBy builds the PostgREST filter", () => {
    expect(deliveredOrSoldBy("GP")).toBe("branch.in.(GP),sales_branch.in.(GP)");
    expect(deliveredOrSoldBy(["KS", "MS"])).toBe("branch.in.(KS,MS),sales_branch.in.(KS,MS)");
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
