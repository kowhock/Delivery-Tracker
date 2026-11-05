import { canPlan } from "./branches";

/**
 * Typed items for M- DOs (inter-company invoices, "M-PT-00000483"). The AutoCount API sends no item
 * lines for invoices, so the office types what goes on the lorry, one item per line ("Cement x 1 bag").
 * Free text: no UOM / quantity boxes and no number checks. Saved in delivery_orders.item_note, which
 * the AutoCount sync never writes (do_items it replaces on every sync, so typed rows there would go).
 */
export const ITEM_NOTE_MAX = 1000;
export const ITEM_NOTE_MAX_LINES = 40;

/** Inter-company invoice delivered as a DO. */
export const isIcbDo = (doNo: string | null | undefined) => !!doNo && doNo.trim().toUpperCase().startsWith("M-");

/** As typed, tidied: each line trimmed (inner spaces collapsed), blank lines dropped. null if nothing is left. */
export function cleanItemNote(text: string | null | undefined): string | null {
  const lines = (text ?? "")
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/[\s ]+/g, " ").trim())
    .filter(Boolean);
  if (!lines.length) return null;
  if (lines.length > ITEM_NOTE_MAX_LINES) throw new Error(`At most ${ITEM_NOTE_MAX_LINES} item lines.`);
  const note = lines.join("\n");
  if (note.length > ITEM_NOTE_MAX) throw new Error(`Items can be at most ${ITEM_NOTE_MAX} characters.`);
  return note;
}

/** The saved items, one per line. */
export const itemNoteLines = (note: string | null | undefined) => (note ?? "").split("\n").filter((l) => l.trim());

type Who = { role: string; branch: string | null };
type Job = { do_no: string; status: string; branch: string | null; helper_branch?: string | null; cancelled?: boolean | null };

/** Admins, or staff of the branch delivering it (or helping deliver it); M- DOs only, until delivered. */
export function canEditItemNote(j: Job, who: Who): boolean {
  if (!isIcbDo(j.do_no) || j.status === "delivered" || j.cancelled) return false;
  if (who.role === "admin") return true;
  return who.role === "dispatcher" && canPlan(who.branch, j.branch, j.helper_branch);
}
