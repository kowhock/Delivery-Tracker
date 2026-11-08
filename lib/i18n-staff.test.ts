import { describe, expect, it } from "vitest";
import { STAFF_DICT, toStaffLang } from "./i18n-staff";

/** Every leaf of a word list: [path, value]. Functions are called with sample values. */
function leaves(o: unknown, path = ""): [string, unknown][] {
  if (typeof o === "function") return [[path, (o as (...a: unknown[]) => unknown)(3, 5)]];
  if (Array.isArray(o) || (o && typeof o === "object")) return Object.entries(o as object).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [[path, o]];
}

describe("staff word lists", () => {
  it("Chinese has every English entry, and nothing is left empty", () => {
    const en = new Map(leaves(STAFF_DICT.en));
    const zh = new Map(leaves(STAFF_DICT.zh));
    expect([...zh.keys()].sort()).toEqual([...en.keys()].sort());
    for (const [k, v] of zh) expect(typeof v === "string" && v.trim() !== "", `zh.${k}`).toBe(true);
  });
  it("translates the screen's words", () => {
    expect(STAFF_DICT.zh.status.pending).toBe("未分配");
    expect(STAFF_DICT.zh.nav.deliveries).toBe("送货");
    expect(STAFF_DICT.zh.doneOf(3, 40)).toBe("已送达 3 / 40");
    expect(STAFF_DICT.en.doneOf(3, 40)).toBe("3 of 40 delivered");
  });
  it("reads the cookie: only zh switches to Chinese", () => {
    expect(toStaffLang("zh")).toBe("zh");
    expect(toStaffLang("en")).toBe("en");
    expect(toStaffLang("ms")).toBe("en"); // the driver app's BM choice doesn't apply here
    expect(toStaffLang(undefined)).toBe("en");
  });
});
