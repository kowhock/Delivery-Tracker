import { describe, expect, it } from "vitest";
import { ITEM_NOTE_MAX, canEditItemNote, cleanItemNote, isIcbDo, itemNoteLines } from "./item-note";

describe("isIcbDo", () => {
  it("is true only for M- invoices", () => {
    expect(isIcbDo("M-PT-00000483")).toBe(true);
    expect(isIcbDo(" m-gp-00003806")).toBe(true);
    expect(isIcbDo("PDD-00046254")).toBe(false);
    expect(isIcbDo("SDO-000123")).toBe(false);
    expect(isIcbDo(null)).toBe(false);
  });
});

describe("cleanItemNote", () => {
  it("trims lines and drops blank ones", () => {
    expect(cleanItemNote("  Cement x 1 bag \r\n\n\nBRC A6   x 2 pcs\n  ")).toBe("Cement x 1 bag\nBRC A6 x 2 pcs");
  });
  it("is null when nothing is typed", () => {
    expect(cleanItemNote("")).toBeNull();
    expect(cleanItemNote(" \n \n")).toBeNull();
    expect(cleanItemNote(null)).toBeNull();
  });
  it("takes any wording, no number checks", () => {
    expect(cleanItemNote("Simen 1.5 bag\n１ roll wire")).toBe("Simen 1.5 bag\n１ roll wire");
  });
  it("refuses too much", () => {
    expect(() => cleanItemNote("x".repeat(ITEM_NOTE_MAX + 1))).toThrow(/at most/);
    expect(() => cleanItemNote(Array(41).fill("Cement").join("\n"))).toThrow(/lines/);
  });
});

describe("itemNoteLines", () => {
  it("splits the saved note", () => {
    expect(itemNoteLines("Cement x 1 bag\nBRC A6 x 2 pcs")).toEqual(["Cement x 1 bag", "BRC A6 x 2 pcs"]);
    expect(itemNoteLines(null)).toEqual([]);
  });
});

describe("canEditItemNote", () => {
  const job = { do_no: "M-PT-00000483", status: "assigned", branch: "PT", helper_branch: null };
  const admin = { role: "admin", branch: "GP" };
  const pt = { role: "dispatcher", branch: "PT" };
  const gp = { role: "dispatcher", branch: "GP" };
  it("lets admins and the delivering branch edit", () => {
    expect(canEditItemNote(job, admin)).toBe(true);
    expect(canEditItemNote(job, pt)).toBe(true);
    expect(canEditItemNote(job, gp)).toBe(false);
  });
  it("lets the branch it was handed over to edit", () => {
    expect(canEditItemNote({ ...job, helper_branch: "GP" }, gp)).toBe(true);
  });
  it("is open until delivered, then locked", () => {
    for (const status of ["pending", "assigned", "out_for_delivery", "failed"]) expect(canEditItemNote({ ...job, status }, pt)).toBe(true);
    expect(canEditItemNote({ ...job, status: "delivered" }, admin)).toBe(false);
  });
  it("is only for M- DOs, never drivers, never cancelled ones", () => {
    expect(canEditItemNote({ ...job, do_no: "PTD-00012345" }, admin)).toBe(false);
    expect(canEditItemNote(job, { role: "driver", branch: "PT" })).toBe(false);
    expect(canEditItemNote({ ...job, cancelled: true }, admin)).toBe(false);
  });
});
