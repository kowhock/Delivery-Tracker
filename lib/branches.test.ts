import { describe, expect, it } from "vitest";
import { branchFromDoNo, branchFromLocation, branchName, branchToSave, canPlan, deliveredOrSoldBy, driverSeesPoints, driversForBranch, lockedBranches, pageBranch, pickBranch, userBranches } from "./branches";
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

  it("knows the branches with their own account book, old prefixes and K- invoices included", () => {
    expect(branchFromDoNo("UTDO-0003057")).toBe("UT");
    expect(branchFromDoNo("DOKKC-00000576")).toBe("UT");
    expect(branchFromDoNo("TTDO-00013511")).toBe("TT");
    expect(branchFromDoNo("NJDO-00000001")).toBe("TT");
    expect(branchFromDoNo("SLDO-00021416")).toBe("KSL");
    expect(branchFromDoNo("PRDO-00017094")).toBe("PR");
    expect(branchFromDoNo("PRD-00000277")).toBe("PR");
    expect(branchFromDoNo("CGDO-00003305")).toBe("CG");
    expect(branchFromDoNo("K-UT-00000663")).toBe("UT");
    expect(branchFromDoNo("K-TT-00001342")).toBe("TT");
    expect(branchFromDoNo("K-PR-1")).toBe("PR");
    expect(branchFromDoNo("K-CG-00000217")).toBe("CG");
    // Seelong's SND- and Kempas's "KS" location are unchanged.
    expect(branchFromDoNo("SND-1")).toBe("SL");
    expect(branchFromLocation("KS")).toBe("KS");
    expect(branchName("TT")).toBe("Jaya Mas (Taman Timor)");
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

  it("canPlan: the branch a DO was handed over to can plan it too", () => {
    expect(canPlan("KS", "GP", "KS")).toBe(true); // helping branch
    expect(canPlan("GP", "GP", "KS")).toBe(true); // own branch still can
    expect(canPlan("PD", "GP", "KS")).toBe(false); // anyone else can't
    expect(canPlan("PD,KS", "GP", "KS")).toBe(true);
    expect(canPlan("KS", "GP", null)).toBe(false);
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
    expect(deliveredOrSoldBy("GP")).toBe("branch.in.(GP),sales_branch.in.(GP),helper_branch.in.(GP)");
    expect(deliveredOrSoldBy(["KS", "MS"])).toBe("branch.in.(KS,MS),sales_branch.in.(KS,MS),helper_branch.in.(KS,MS)");
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

describe("driversForBranch", () => {
  const gp = { id: "1", branch: "GP" };
  const ks = { id: "2", branch: "KS" };
  const both = { id: "3", branch: "KS,MS" };
  const none = { id: "4", branch: null };
  const all = [gp, ks, both, none];

  it("lists only the DO branch's own drivers", () => {
    expect(driversForBranch(all, "GP")).toEqual([gp]);
    expect(driversForBranch(all, "MS")).toEqual([both]);
  });

  it("adds the helping branch's drivers", () => {
    expect(driversForBranch(all, "GP", "KS")).toEqual([gp, ks, both]);
  });

  it("falls back to every driver when the branch has none, or there's no branch", () => {
    expect(driversForBranch(all, "PT")).toBe(all);
    expect(driversForBranch(all, null)).toBe(all);
    expect(driversForBranch(all, "")).toBe(all);
  });
});

import { LORRY_BRANCHES, hasLorries, isRetiredDo } from "./branches";
describe("hasLorries", () => {
  it("store branches only (NB2 is no longer used)", () => {
    expect(hasLorries("GP")).toBe(true);
    expect(hasLorries("NB2")).toBe(false);
    expect(hasLorries("XX")).toBe(false);
    expect(hasLorries(null)).toBe(false);
    expect(LORRY_BRANCHES.map((b) => b.code)).not.toContain("NB2");
  });
});

describe("NB2 retired", () => {
  it("NBD- DOs are retired and belong to no branch", () => {
    expect(isRetiredDo("NBD-00001234")).toBe(true);
    expect(isRetiredDo(" nbd-00001234 ")).toBe(true);
    expect(branchFromDoNo("NBD-00001234")).toBeNull();
    expect(branchName("NB2")).toBe("NB2"); // old rows still show their code
  });
  it("other DOs aren't", () => {
    for (const no of ["GPD-00044524", "TTDO-00013511", "K-TT-00001355", "M-PT-00000483"]) expect(isRetiredDo(no)).toBe(false);
  });
});

describe("driverSeesPoints", () => {
  const off = new Set(["PR"]);
  it("hides points when all the driver's branches have points off", () => {
    expect(driverSeesPoints("PR", off)).toBe(false);
    expect(driverSeesPoints(" pr ", off)).toBe(false);
  });
  it("shows points when any branch of theirs earns, or they have none", () => {
    expect(driverSeesPoints("PR,MS", off)).toBe(true);
    expect(driverSeesPoints("MS", off)).toBe(true);
    expect(driverSeesPoints(null, off)).toBe(true);
    expect(driverSeesPoints("PR", new Set())).toBe(true);
  });
});
