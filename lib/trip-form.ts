/**
 * What the office types on the trip form and the app keeps (trip_form_notes), per driver per day:
 * - remark:          monthly form Remarks (OFF, MC, …)
 * - trips:           daily form Trip box, typed when the app has no trips that day
 * - check:<CHECK>:   daily form Lorry checking boxes
 * Typed DOs are not notes: they're saved to the DO itself (recordTripFormDo).
 */
export const LORRY_CHECKS = ["HYDRAULIC OIL", "ENGINE OIL", "WATER LEVEL", "TYRE"] as const;
export const checkField = (c: string) => `check:${c}`;
export const NOTE_FIELDS: string[] = ["remark", "trips", ...LORRY_CHECKS.map(checkField)];
export const isNoteField = (f: unknown): f is string => typeof f === "string" && NOTE_FIELDS.includes(f);

export const NOTE_MAX = 60;

/** Trimmed, upper case, single spaces. "" = nothing (the saved one is removed). Throws if too long. */
export function cleanNote(text: string): string {
  const s = text.replace(/\s+/g, " ").trim().toUpperCase();
  if (s.length > NOTE_MAX) throw new Error(`Keep it to ${NOTE_MAX} characters.`);
  return s;
}
