import { describe, expect, it } from "vitest";
import {
  RETIRED_REASONS,
  SPECIAL_REASONS,
  canEditSpecial,
  canHandleGoods,
  canPrintSpecial,
  isRetiredReason,
  parseSpecialItems,
  usesSpecialOrders,
} from "./special";

const sdo = (o: Partial<Parameters<typeof canEditSpecial>[0]> = {}) => ({
  source: "special",
  special_no: null,
  special_reason: "stock_transfer",
  created_by: "creator",
  print_count: 0,
  voided_at: null,
  ...o,
});
const admin = { id: "a", role: "admin" };
const creator = { id: "creator", role: "dispatcher" };
const other = { id: "x", role: "dispatcher" };
const allowed = { id: "y", role: "dispatcher", sdo_goods: true };

describe("usesSpecialOrders", () => {
  it("every branch, but a special order needs one", () => {
    for (const b of ["GP", "PD", "KS"]) expect(usesSpecialOrders(b)).toBe(true);
    for (const b of ["", null, undefined]) expect(usesSpecialOrders(b)).toBe(false);
  });
});

describe("canEditSpecial", () => {
  it("other reasons: creator or admin", () => {
    expect(canEditSpecial(sdo(), creator)).toBe(true);
    expect(canEditSpecial(sdo(), admin)).toBe(true);
    expect(canEditSpecial(sdo(), other)).toBe(false);
  });
  it("Kurang Hantar: only allowed dispatchers and admins, even if someone else created it", () => {
    expect(canEditSpecial(sdo({ special_reason: "tumpang_barang" }), allowed)).toBe(true);
    expect(canEditSpecial(sdo({ special_reason: "tumpang_barang" }), admin)).toBe(true);
    expect(canEditSpecial(sdo({ special_reason: "tumpang_barang" }), creator)).toBe(false);
  });
  it("Ambil Barang / System Down: any staff, not only the creator", () => {
    for (const reason of ["ambil_barang", "system_down"]) {
      for (const who of [creator, admin, other, allowed]) expect(canEditSpecial(sdo({ special_reason: reason }), who)).toBe(true);
      expect(canEditSpecial(sdo({ special_reason: reason }), { id: "d", role: "driver" })).toBe(false);
    }
  });
  it("printed: only admins and allowed dispatchers, not the creator", () => {
    for (const reason of ["tumpang_barang", "stock_transfer", "ambil_barang", "system_down"]) {
      const d = sdo({ special_reason: reason, print_count: 1 });
      expect(canEditSpecial(d, admin)).toBe(true);
      expect(canEditSpecial(d, allowed)).toBe(true);
      expect(canEditSpecial(d, creator)).toBe(false);
      expect(canEditSpecial(d, other)).toBe(false);
    }
  });
  it("nobody once void or linked — admins included", () => {
    for (const d of [sdo({ voided_at: "2026-11-02T00:00:00Z" }), sdo({ special_no: "SDO-000001" })]) {
      expect(canEditSpecial(d, admin)).toBe(false);
      expect(canEditSpecial(d, creator)).toBe(false);
    }
  });
});

describe("canPrintSpecial", () => {
  it("Kurang Hantar: allowed people only; never when void; reprint ok", () => {
    expect(canPrintSpecial(sdo({ special_reason: "tumpang_barang" }), allowed)).toBe(true);
    expect(canPrintSpecial(sdo({ special_reason: "tumpang_barang", print_count: 2 }), admin)).toBe(true);
    expect(canPrintSpecial(sdo({ special_reason: "tumpang_barang" }), other)).toBe(false);
    expect(canPrintSpecial(sdo({ special_reason: "stock_transfer" }), admin)).toBe(false);
    expect(canPrintSpecial(sdo({ special_reason: "other" }), admin)).toBe(false);
    expect(canPrintSpecial(sdo({ special_reason: "tumpang_barang", voided_at: "x" }), admin)).toBe(false);
  });
  it("Ambil Barang / System Down: any staff prints and reprints, never when void", () => {
    for (const reason of ["ambil_barang", "system_down"]) {
      expect(canPrintSpecial(sdo({ special_reason: reason }), other)).toBe(true);
      expect(canPrintSpecial(sdo({ special_reason: reason, print_count: 1 }), creator)).toBe(true);
      expect(canPrintSpecial(sdo({ special_reason: reason, voided_at: "x" }), admin)).toBe(false);
      expect(canPrintSpecial(sdo({ special_reason: reason }), { id: "d", role: "driver" })).toBe(false);
    }
  });
  it("canHandleGoods", () => {
    expect(canHandleGoods(admin)).toBe(true);
    expect(canHandleGoods(allowed)).toBe(true);
    expect(canHandleGoods(other)).toBe(false);
  });
});

describe("parseSpecialItems", () => {
  const form = (rows: [string, string, string][]) => {
    const f = new FormData();
    for (const [n, u, q] of rows) {
      f.append("item_name", n);
      f.append("item_uom", u);
      f.append("item_qty", q);
    }
    return f;
  };
  it("reads rows and skips blank ones", () => {
    expect(parseSpecialItems(form([["Batu Bata", "NOS", "1352"], ["", "", ""], [" Simen ", "BAG", "3"]]))).toEqual([
      { description: "Batu Bata", uom: "NOS", qty: 1352 },
      { description: "Simen", uom: "BAG", qty: 3 },
    ]);
  });
  it("refuses half-filled rows and bad quantities", () => {
    expect(() => parseSpecialItems(form([["", "NOS", "1"]]))).toThrow(/item name/);
    expect(() => parseSpecialItems(form([["Pipe", "", "1"]]))).toThrow(/UOM/);
    expect(() => parseSpecialItems(form([["Pipe", "LGTH", "0"]]))).toThrow(/quantity/);
    expect(() => parseSpecialItems(form([["Pipe", "LGTH", "1.5"]]))).toThrow(/quantity/);
    expect(() => parseSpecialItems(form([["Pipe", "LGTH", "-2"]]))).toThrow(/quantity/);
  });
});

describe("reasons", () => {
  it("System Down is offered; Ambil DO / Give DO is retired but still has its label", () => {
    expect(SPECIAL_REASONS.system_down).toBe("System Down");
    expect(isRetiredReason("ambil_give_do")).toBe(true);
    expect(isRetiredReason("system_down")).toBe(false);
    expect(SPECIAL_REASONS[RETIRED_REASONS[0]]).toBe("Ambil DO / Give DO");
  });
});
