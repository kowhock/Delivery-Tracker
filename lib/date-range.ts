import { addDays } from "./format";

/** 2026-11-03 → 03/11/2026 */
export const dmy = (iso: string) => iso.split("-").reverse().join("/");

/** Days of one month (month 1–12) laid out Monday-first, null = blank cell before the 1st / after the last. */
export function monthGrid(year: number, month: number): (string | null)[] {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const lead = (new Date(first + "T00:00:00Z").getUTCDay() + 6) % 7; // Monday = 0
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let i = 0; i < days; i++) cells.push(addDays(first, i));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** The two picked days in order, the end kept within `max` days of the start (no limit if not given). */
export function orderRange(a: string, b: string, max?: number): [string, string] {
  const [from, to] = a <= b ? [a, b] : [b, a];
  if (!max) return [from, to];
  const last = addDays(from, max - 1);
  return [from, to > last ? last : to];
}

/** First and last day of the month `offset` months from `day` (0 = this month, -1 = last month). */
export function monthRange(day: string, offset = 0): [string, string] {
  const [y, m] = day.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1 + offset, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}
