import { BRANCHES } from "./branches";
import { addDays } from "./format";

/**
 * The Deliveries board's Unassigned column has two tabs, split by the AutoCount DO date (doc_date) rather than the
 * delivery date (which an old rollover moved to "today" for many DOs):
 * - New: DOs planned inside the dates on screen whose DO date is inside them too (or that have none, e.g. special
 *   DOs), and ones a dispatcher planned for a later day.
 * - Overdue: still not assigned, planned for today or earlier, and their planned day or DO date is before the dates
 *   on screen. Only the last OVERDUE_DAYS are shown, and for now nothing before OVERDUE_SINCE (M book:
 *   OVERDUE_SINCE_M_BOOK); older ones are left for a clean-up (a search still finds them).
 * Assigning a driver moves an old DO to today. The page's database filters (app/(staff)/deliveries/page.tsx) do the
 * same as unassignedTab() below; lib/overdue.test.ts checks this rule.
 */
export const OVERDUE_DAYS = 30;
/** For now Overdue starts here: October's DOs are hidden from it until they're cleaned up. */
export const OVERDUE_SINCE = "2026-11-01";
/**
 * For now, the M book's branches (GP, PD, KS, MS, PT, SL) start later: their Unassigned DOs from before this (more than
 * 10 days old on 19 Nov 2026) are hidden so Overdue isn't overwhelming — most were delivered without being marked.
 * A fixed date, so DOs that become overdue from now on are never hidden. Set it to OVERDUE_SINCE to show them again.
 */
export const OVERDUE_SINCE_M_BOOK = "2026-11-09";
/** Branches with their own AutoCount book (UT, TT, KSL, PR, CG); every other DO is the M book's. */
export const OWN_BOOK_BRANCHES: string[] = BRANCHES.filter((b) => b.accountBook).map((b) => b.code);

const later = (a: string, b: string) => (a > b ? a : b);

/** How far back Overdue reaches when the dates on screen start at `from`: every branch, and the M book's. */
export function overdueWindow(from: string) {
  const overdueFrom = later(addDays(from, -OVERDUE_DAYS), OVERDUE_SINCE);
  return { overdueFrom, mBookFrom: later(OVERDUE_SINCE_M_BOOK, overdueFrom) };
}

type Job = { delivery_date: string; doc_date: string | null; branch: string | null };

/** Which Unassigned tab a DO is in, for the dates `from`–`to` (`to` "" = no end) seen on `today`; null = neither. */
export function unassignedTab(j: Job, from: string, to: string, today: string): "new" | "overdue" | null {
  const { overdueFrom, mBookFrom } = overdueWindow(from);
  const since = (d: string) => j.delivery_date >= d && (!j.doc_date || j.doc_date >= d);
  const overdue =
    j.delivery_date <= today &&
    (j.delivery_date < from || (!!j.doc_date && j.doc_date < from)) &&
    since(overdueFrom) &&
    ((!!j.branch && OWN_BOOK_BRANCHES.includes(j.branch)) || since(mBookFrom));
  if (overdue) return "overdue";
  const inDates = j.delivery_date >= from && (!to || j.delivery_date <= to);
  if (inDates && (!j.doc_date || j.doc_date >= from || j.delivery_date > today)) return "new";
  return null;
}

/** The day an Unassigned DO became late: its planned day once passed, else its DO date once passed; null = not late. */
export function lateSince(j: Pick<Job, "delivery_date" | "doc_date">, today: string): string | null {
  if (j.delivery_date < today) return j.delivery_date;
  return j.doc_date && j.doc_date < today && j.delivery_date <= today ? j.doc_date : null;
}

/** Whole days from `d` to `today` (both YYYY-MM-DD). */
export const daysBetween = (d: string, today: string) => Math.round((Date.parse(today) - Date.parse(d)) / 864e5);
