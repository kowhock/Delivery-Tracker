/**
 * Special order (SDO) rules: reason, items, print and void.
 *
 * Only branches in SPECIAL_ORDER_BRANCHES get them for now (GP first); other branches keep the
 * plain special DO form. To roll out to another branch, add its code here.
 *
 * - Every SDO of these branches needs a reason.
 * - Tumpang Barang (the "goods" reason) has its own items and prints as a Delivery Order; only
 *   admins and dispatchers an admin ticked on Admin access (profiles.sdo_goods) can pick it, edit or print it.
 * - Every other reason (Ambil Barang included) is a normal special order: creator or admin edits.
 * - Once printed, only admins and ticked dispatchers (canHandleGoods) can edit it; reprints are marked REPRINT.
 * - No special DO is ever deleted (any branch, any reason): an admin voids it (kept, shown as VOID).
 * The printed-edit rule and the void are also enforced in the database (guard_special_order in schema.sql).
 */

export const SPECIAL_ORDER_BRANCHES = ["GP"];

export const SPECIAL_REASONS = {
  ambil_barang: "Ambil Barang",
  tumpang_barang: "Tumpang Barang",
  stock_transfer: "Stock Transfer",
  ambil_give_do: "Ambil DO / Give DO",
  other: "Other",
} as const;

export type SpecialReason = keyof typeof SPECIAL_REASONS;

export const GOODS_REASONS: SpecialReason[] = ["tumpang_barang"];

export const isSpecialReason = (r: unknown): r is SpecialReason => typeof r === "string" && r in SPECIAL_REASONS;

/** This branch's special DOs use reason / items / print / void. */
export const usesSpecialOrders = (branch: string | null | undefined) => !!branch && SPECIAL_ORDER_BRANCHES.includes(branch);

export const isGoodsReason = (r: string | null | undefined) => !!r && (GOODS_REASONS as string[]).includes(r);

/** Only Tumpang Barang has item rows and prints (as a Delivery Order). */
export const PRINT_REASONS: SpecialReason[] = ["tumpang_barang"];
export const isPrintReason = (r: string | null | undefined) => !!r && (PRINT_REASONS as string[]).includes(r);

/** May pick a goods reason, and edit / print a goods SDO. */
export const canHandleGoods = (p: { role: string; sdo_goods?: boolean | null }) => p.role === "admin" || !!p.sdo_goods;

type Sdo = { source: string; special_no: string | null; special_reason: string | null; created_by: string | null; print_count: number; voided_at: string | null };
type Who = { id: string; role: string; sdo_goods?: boolean | null };

/** Edit rights, ignoring delivery status (see SPECIAL_EDITABLE): goods or printed SDOs → credential; others → creator or admin. */
export function canEditSpecial(d: Sdo, who: Who): boolean {
  if (d.source !== "special" || d.special_no || d.voided_at) return false;
  if (d.print_count > 0 || isGoodsReason(d.special_reason)) return canHandleGoods(who);
  return d.created_by === who.id || who.role === "admin";
}

export const canPrintSpecial = (d: Sdo, who: Who) => d.source === "special" && !d.voided_at && isPrintReason(d.special_reason) && canHandleGoods(who);

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
