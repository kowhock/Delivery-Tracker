import { BRANCHES } from "./branches";

/**
 * Special order (SDO) rules: reason, items, print and void.
 *
 * Every branch in SPECIAL_ORDER_BRANCHES (all of them since 2026-11-03; GP first) uses them.
 *
 * - Every SDO needs a reason.
 * - Kurang Hantar, Ambil Barang and System Down (PRINT_REASONS) have their own items (item / UOM / qty)
 *   and print as a Delivery Order.
 * - Kurang Hantar (the "goods" reason): only admins and dispatchers an admin ticked on Admin access
 *   (profiles.sdo_goods) can pick it, edit or print it.
 * - Ambil Barang and System Down (OPEN_REASONS): any staff can open, edit and print them.
 * - Every other reason: a normal special order — creator or admin edits, no items, no print.
 * - Once printed, only admins and ticked dispatchers (canHandleGoods) can edit it; anyone allowed to
 *   print can reprint (marked REPRINT).
 * - No special DO is ever deleted (any branch, any reason): an admin voids it (kept, shown as VOID).
 * The printed-edit rule and the void are also enforced in the database (guard_special_order in schema.sql).
 */

export const SPECIAL_ORDER_BRANCHES: string[] = BRANCHES.map((b) => b.code);

export const SPECIAL_REASONS = {
  ambil_barang: "Ambil Barang",
  tumpang_barang: "Kurang Hantar",
  stock_transfer: "Stock Transfer",
  system_down: "System Down",
  other: "Other",
  ambil_give_do: "Ambil DO / Give DO", // retired 2026-11-02 (see RETIRED_REASONS)
} as const;

export type SpecialReason = keyof typeof SPECIAL_REASONS;

/** No longer offered for new or changed SDOs; kept so older SDOs still show their reason. */
export const RETIRED_REASONS: SpecialReason[] = ["ambil_give_do"];
export const isRetiredReason = (r: string | null | undefined) => !!r && (RETIRED_REASONS as string[]).includes(r);

export const GOODS_REASONS: SpecialReason[] = ["tumpang_barang"];

export const isSpecialReason = (r: unknown): r is SpecialReason => typeof r === "string" && r in SPECIAL_REASONS;

/** This branch's special DOs use reason / items / print / void. */
export const usesSpecialOrders = (branch: string | null | undefined) => !!branch && SPECIAL_ORDER_BRANCHES.includes(branch);

export const isGoodsReason = (r: string | null | undefined) => !!r && (GOODS_REASONS as string[]).includes(r);

/** Have item rows and print (as a Delivery Order). */
export const PRINT_REASONS: SpecialReason[] = ["tumpang_barang", "ambil_barang", "system_down"];
export const isPrintReason = (r: string | null | undefined) => !!r && (PRINT_REASONS as string[]).includes(r);

/** Any staff may open, edit (until printed) and print these, not only the creator. */
export const OPEN_REASONS: SpecialReason[] = ["ambil_barang", "system_down"];
export const isOpenReason = (r: string | null | undefined) => !!r && (OPEN_REASONS as string[]).includes(r);

const isStaff = (who: { role: string }) => who.role === "admin" || who.role === "dispatcher";

/** May pick a goods reason, and edit / print a goods SDO. */
export const canHandleGoods = (p: { role: string; sdo_goods?: boolean | null }) => p.role === "admin" || !!p.sdo_goods;

type Sdo = { source: string; special_no: string | null; special_reason: string | null; created_by: string | null; print_count: number; voided_at: string | null };
type Who = { id: string; role: string; sdo_goods?: boolean | null };

/**
 * Edit rights, ignoring delivery status (see SPECIAL_EDITABLE): goods or printed SDOs → admins + ticked
 * dispatchers; Ambil Barang / System Down → any staff; others → creator or admin.
 */
export function canEditSpecial(d: Sdo, who: Who): boolean {
  if (d.source !== "special" || d.special_no || d.voided_at) return false;
  if (d.print_count > 0 || isGoodsReason(d.special_reason)) return canHandleGoods(who);
  if (isOpenReason(d.special_reason)) return isStaff(who);
  return d.created_by === who.id || who.role === "admin";
}

export const PRINT_HELP =
  "Only Kurang Hantar, Ambil Barang and System Down special orders print. Kurang Hantar: admins and dispatchers an admin has allowed.";

/** Kurang Hantar: admins + ticked dispatchers. Ambil Barang / System Down: any staff. Never when void. */
export const canPrintSpecial = (d: Sdo, who: Who) =>
  d.source === "special" && !d.voided_at && isPrintReason(d.special_reason) && (isGoodsReason(d.special_reason) ? canHandleGoods(who) : isStaff(who));

export type SpecialItemInput = { description: string; uom: string; qty: number };

/** Item rows from the form (item_name[], item_uom[], item_qty[]); blank rows are skipped. */
export function parseSpecialItems(formData: FormData): SpecialItemInput[] {
  const names = formData.getAll("item_name").map((v) => String(v).trim());
  const uoms = formData.getAll("item_uom").map((v) => String(v).trim());
  const qtys = formData.getAll("item_qty").map((v) => String(v).trim());
  const items: SpecialItemInput[] = [];
  names.forEach((description, i) => {
    const uom = uoms[i] ?? "";
    const raw = qtys[i] ?? "";
    if (!description && !uom && !raw) return;
    const qty = Number(raw);
    if (!description) throw new Error(`Item ${i + 1}: enter the item name.`);
    if (!uom) throw new Error(`Item ${i + 1} (${description}): enter the UOM.`);
    if (!Number.isInteger(qty) || qty < 1) throw new Error(`Item ${i + 1} (${description}): quantity must be a whole number (1, 2, 3…).`);
    items.push({ description, uom, qty });
  });
  return items;
}
