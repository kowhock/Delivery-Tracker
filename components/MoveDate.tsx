"use client";

import { useState, useTransition } from "react";
import { moveToDate, setTimeSlot } from "@/app/actions";
import { TIME_SLOTS, type TimeSlot } from "@/lib/types";
import { addDays, dayLabel } from "@/lib/format";

const QUICK_DAYS = [0, 1, 2]; // today, tomorrow, the day after

/** Today, tomorrow, the day after — plus the DO's own date when it's none of those (e.g. late). */
function dayOptions(today: string, current?: string) {
  const days = QUICK_DAYS.map((n) => addDays(today, n));
  if (current && !days.includes(current)) days.unshift(current);
  return days.map((d) => ({ value: d, label: dayLabel(d, today) + (d < today ? " (late)" : "") }));
}

/** A day dropdown with "Pick a date…" that swaps to a calendar input. */
function DayPicker({
  today,
  value,
  disabled,
  onPick,
  className = "",
}: {
  today: string;
  value?: string;
  disabled?: boolean;
  onPick: (date: string) => void;
  className?: string;
}) {
  const [picking, setPicking] = useState(false);
  if (picking) {
    return (
      <input
        type="date"
        autoFocus
        min={today}
        defaultValue={value}
        disabled={disabled}
        aria-label="Delivery date"
        onChange={(e) => e.target.value && e.target.value >= today && onPick(e.target.value)}
        onBlur={() => setPicking(false)}
        className={`input py-1.5 text-xs ${className}`}
      />
    );
  }
  return (
    <select
      key={value}
      disabled={disabled}
      defaultValue={value ?? ""}
      aria-label="Delivery date"
      onChange={(e) => (e.target.value === "pick" ? setPicking(true) : e.target.value && onPick(e.target.value))}
      className={`input py-1.5 text-xs ${className}`}
    >
      {dayOptions(today, value).map((o) => (
        <option key={o.value} value={o.value} disabled={o.value < today}>
          📅 {o.label}
        </option>
      ))}
      <option value="pick">📅 Pick a date…</option>
    </select>
  );
}

/** One DO's delivery day. */
export function DoDate({ doId, date, today }: { doId: string; date: string; today: string }) {
  const [pending, start] = useTransition();
  return (
    <DayPicker
      today={today}
      value={date}
      disabled={pending}
      onPick={(d) => d !== date && start(async () => void (await moveToDate([doId], d)))}
      className="w-full"
    />
  );
}

/** One DO's optional estimated delivery window. */
export function DoTimeSlot({ doId, slot }: { doId: string; slot: TimeSlot | null }) {
  const [pending, start] = useTransition();
  return (
    <select
      key={slot ?? ""}
      disabled={pending}
      defaultValue={slot ?? ""}
      aria-label="Estimated time"
      onChange={(e) => start(async () => void (await setTimeSlot(doId, e.target.value || null)))}
      className="input w-full py-1.5 text-xs"
    >
      <option value="">🕒 No time estimate</option>
      {Object.entries(TIME_SLOTS).map(([v, label]) => (
        <option key={v} value={v}>
          🕒 Estimated {label}
        </option>
      ))}
    </select>
  );
}
