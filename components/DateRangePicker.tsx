"use client";

import { useEffect, useRef, useState } from "react";
import { addDays } from "@/lib/format";
import { dmy, monthGrid, monthRange, orderRange } from "@/lib/date-range";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * From–To picker for a form (sends `from` and `to` as YYYY-MM-DD). Shown as day/month/year.
 * Press on the start day and drag to the end day, or click one then the other (‹ › to cross months).
 * Picking a range submits the form. At most `max` days (no limit if not given).
 * from / to may be "" (e.g. Deliveries' All dates): the button then says "All dates" or "… – 30/11/2026".
 */
export function DateRangePicker({ from, to, today, max, small = false, align = "right" }: {
  from: string; to: string; today: string; max?: number;
  /** Compact button, for toolbars like Deliveries. */
  small?: boolean;
  /** Which edge of the button the calendar lines up with. */
  align?: "left" | "right";
}) {
  const [range, setRange] = useState<[string, string]>([from, to]);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => (from || to || today).slice(0, 7)); // YYYY-MM on show
  const [anchor, setAnchor] = useState<string | null>(null); // first day picked, waiting for the second
  const [hover, setHover] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  // Close when clicking outside or pressing Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  });

  function close() {
    setOpen(false);
    setAnchor(null);
    setHover(null);
    setDragging(false);
  }

  function apply(next: [string, string]) {
    setRange(next);
    close();
    formRef.current = box.current?.closest("form") ?? null;
    // Let the hidden inputs update first, then load the form for the new dates.
    requestAnimationFrame(() => formRef.current?.requestSubmit());
  }

  // The day under the pointer (works for touch drags too, where events stay on the first cell).
  const dayAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-day]")?.dataset.day ?? null;

  const [y, m] = view.split("-").map(Number);
  const shift = (n: number) => setView(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  const shown: [string, string] = anchor ? orderRange(anchor, hover ?? anchor, max) : range;
  const capped = !!anchor && !!hover && orderRange(anchor, hover, max)[1] !== (anchor <= hover ? hover : anchor);

  const presets: [string, [string, string]][] = [
    ["Today", [today, today]],
    ["Yesterday", [addDays(today, -1), addDays(today, -1)]],
    ["This month", monthRange(today)],
    ["Last month", monthRange(today, -1)],
  ];

  return (
    <div ref={box} className="relative">
      <input type="hidden" name="from" value={range[0]} />
      <input type="hidden" name="to" value={range[1]} />
      <button
        type="button"
        onClick={() => (open ? close() : (setView((range[0] || range[1] || today).slice(0, 7)), setOpen(true)))}
        className={`input inline-flex w-auto items-center gap-1.5 text-left tabular-nums ${small ? "px-2 py-1 text-xs" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarIcon className={`shrink-0 text-slate-500 ${small ? "size-3.5" : "size-4"}`} />
        {!range[0] && !range[1] ? "All dates" : range[0] === range[1] ? dmy(range[0]) : `${range[0] ? dmy(range[0]) : "…"} – ${range[1] ? dmy(range[1]) : "…"}`}
      </button>

      {open && (
        <div role="dialog" aria-label="Pick dates" className={`absolute ${align === "left" ? "left-0" : "right-0"} z-30 mt-2 w-[18.5rem] rounded-xl border border-slate-200 bg-white text-sm shadow-lg`}>
          {/* Month */}
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <button type="button" onClick={() => shift(-1)} className="flex size-8 items-center justify-center rounded-md text-lg text-slate-600 hover:bg-slate-100" aria-label="Previous month">‹</button>
            <span className="text-sm font-semibold">{MONTHS[m - 1]} {y}</span>
            <button type="button" onClick={() => shift(1)} className="flex size-8 items-center justify-center rounded-md text-lg text-slate-600 hover:bg-slate-100" aria-label="Next month">›</button>
          </div>

          {/* Days: press and drag, or click the first and last day */}
          <div
            className="grid touch-none select-none grid-cols-7 gap-y-1 px-3 py-2 text-center text-sm"
            onPointerMove={(e) => {
              if (!anchor) return;
              const d = dragging ? dayAt(e.clientX, e.clientY) : (e.target as HTMLElement).closest<HTMLElement>("[data-day]")?.dataset.day;
              if (d) setHover(d);
            }}
            onPointerUp={(e) => {
              if (!dragging || !anchor) return;
              setDragging(false);
              const d = dayAt(e.clientX, e.clientY) ?? hover ?? anchor;
              // Released on another day = a dragged range. Released on the same day = wait for a second click.
              if (d !== anchor) apply(orderRange(anchor, d, max));
            }}
          >
            {WEEKDAYS.map((w) => (
              <span key={w} className="pb-1 text-[11px] font-medium uppercase text-slate-400">{w}</span>
            ))}
            {monthGrid(y, m).map((d, i) => {
              if (!d) return <span key={i} className="h-9" />;
              const inRange = d >= shown[0] && d <= shown[1];
              const start = d === shown[0];
              const end = d === shown[1];
              // One band across the range, rounded at its ends and at each week's edge.
              const band = inRange
                ? `bg-brand-50 ${start || i % 7 === 0 ? "rounded-l-md" : ""} ${end || i % 7 === 6 ? "rounded-r-md" : ""}`
                : "";
              return (
                <div key={d} className={`h-9 ${band}`}>
                  <button
                    type="button"
                    data-day={d}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      if (anchor && !dragging) {
                        // Second click (after clicking the first day, maybe in another month).
                        apply(orderRange(anchor, d, max));
                        return;
                      }
                      setAnchor(d);
                      setHover(d);
                      setDragging(true);
                    }}
                    className={`size-9 rounded-md tabular-nums ${
                      start || end ? "bg-brand-600 font-semibold text-white" : inRange ? "text-brand-800 hover:bg-brand-100" : "text-slate-700 hover:bg-slate-100"
                    } ${d === today && !(start || end) ? "font-bold ring-1 ring-inset ring-brand-600" : ""}`}
                    aria-label={dmy(d)}
                    aria-pressed={inRange}
                  >
                    {Number(d.slice(8))}
                  </button>
                </div>
              );
            })}
          </div>

          {capped && max && <p className="px-3 pb-2 text-xs text-amber-700">Up to {max} days at a time.</p>}

          {/* Quick picks */}
          <div className="grid grid-cols-4 gap-1 border-t border-slate-100 p-2">
            {presets.map(([label, r]) => (
              <button key={label} type="button" onClick={() => apply(r)} className="rounded-md px-1 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Calendar outline icon (shown on the left of the dates). */
function CalendarIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </svg>
  );
}
