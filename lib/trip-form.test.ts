import { describe, expect, it } from "vitest";
import { NOTE_MAX, checkField, cleanNote, isNoteField } from "./trip-form";

describe("cleanNote", () => {
  it("trims, upper-cases and collapses spaces", () => {
    expect(cleanNote("  mc   half day ")).toBe("MC HALF DAY");
  });
  it("blank means nothing saved", () => {
    expect(cleanNote("   ")).toBe("");
  });
  it("rejects text that is too long", () => {
    expect(cleanNote("A".repeat(NOTE_MAX))).toHaveLength(NOTE_MAX);
    expect(() => cleanNote("A".repeat(NOTE_MAX + 1))).toThrow(/characters/);
  });
});

describe("isNoteField", () => {
  it("knows the monthly remark, the daily trips box and the lorry checks only", () => {
    expect(isNoteField("remark")).toBe(true);
    expect(isNoteField("trips")).toBe(true);
    expect(isNoteField(checkField("TYRE"))).toBe(true);
    expect(isNoteField("check:BRAKES")).toBe(false);
    expect(isNoteField("points")).toBe(false);
  });
});
