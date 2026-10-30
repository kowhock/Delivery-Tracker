const TZ = "Asia/Kuala_Lumpur";

/** Today's date in Malaysia as YYYY-MM-DD (servers usually run in UTC). */
export function todayMY(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Monday and Sunday (YYYY-MM-DD) of the week containing `day`. */
export function weekRange(day: string): [string, string] {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const mon = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  return [mon, d.toISOString().slice(0, 10)];
}

export function fmtDate(d: string | null | undefined, locale = "en-MY"): string {
  if (!d) return "—";
  return new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: d.length === 10 ? undefined : TZ,
  });
}

/** Every YYYY-MM-DD from `from` to `to` inclusive, capped at `max` days. */
export function dateRange(from: string, to: string, max = 31): string[] {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  while (out.length < max) {
    const s = d.toISOString().slice(0, 10);
    if (s > to) break;
    out.push(s);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString("en-MY", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
  });
}

/** "2:15pm" in Malaysia time; "" when there's no time. */
export function fmtTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit", timeZone: TZ }).replace(" ", "").toLowerCase() : "";
}

export function fmtQty(n: number): string {
  return Number(n).toLocaleString("en-MY", { maximumFractionDigits: 2 });
}

/**
 * Turns messy Malaysian phone numbers into WhatsApp format (60123456789).
 * "012-345 6789", "+6012 3456789", "12-3456789" → "60123456789".
 * If several numbers are listed ("012-3456789 / 03-12345678") the first is used.
 * Returns null when nothing usable is found.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(/[\/,;]|\bor\b/i)[0];
  let d = first.replace(/\D/g, "");
  if (d.startsWith("0")) d = "6" + d;
  else if (d.startsWith("1")) d = "60" + d;
  return /^60\d{8,10}$/.test(d) ? d : null;
}

/** Mobile numbers (601x...) can receive WhatsApp; landlines (603...) cannot. */
export function isMobile(normalized: string | null): boolean {
  return !!normalized && /^601\d{8,9}$/.test(normalized);
}

/** The address to find on the map: the one the office typed in, else the delivery address. */
export const mapAddress = (d: { address: string | null; map_address?: string | null }) => d.map_address?.trim() || d.address;

/** Waze / Google Maps links. Pass `at` (the spot Google found) to navigate there exactly. */
export function mapsLinks(address: string, at?: { lat: number; lng: number } | null) {
  if (at) {
    const ll = `${at.lat},${at.lng}`;
    return {
      waze: `https://waze.com/ul?ll=${ll}&navigate=yes`,
      google: `https://www.google.com/maps/search/?api=1&query=${ll}`,
    };
  }
  const q = encodeURIComponent(address);
  return {
    waze: `https://waze.com/ul?q=${q}&navigate=yes`,
    google: `https://www.google.com/maps/search/?api=1&query=${q}`,
  };
}

/** "Azli · Lorry 93" — staff know lorries by number, so show it with the name. */
export function driverLabel(d: { full_name: string; lorry_no?: string | null }): string {
  return d.lorry_no ? `${d.full_name} · Lorry ${d.lorry_no}` : d.full_name;
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return "RM " + Number(n).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** YYYY-MM-DD plus `n` days. */
export function addDays(d: string, n: number): string {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** "Today · 7 Oct", "Tomorrow · 8 Oct", "Fri · 9 Oct". */
export function dayLabel(d: string, today: string): string {
  const t = new Date(d + "T00:00:00Z");
  const short = t.toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "UTC" });
  if (d === today) return `Today · ${short}`;
  if (d === addDays(today, 1)) return `Tomorrow · ${short}`;
  return `${t.toLocaleDateString("en-MY", { weekday: "short", timeZone: "UTC" })} · ${short}`;
}

/** A time typed on the trip form → "HH:MM" (24h), or null: "14:30", "1430", "2.30pm", "2:30 PM", "9am". */
export function parseTime(raw: string): string | null {
  const m = raw.trim().toUpperCase().match(/^(\d{1,2})(?:[:.]?(\d{2}))?\s*(AM|PM)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === "PM" ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
