"use client";

import { Children, useEffect, useState } from "react";

type Column = { key: string; label: string; dot: string; count: number };

const STORE = "deliveries-column";

/**
 * Deliveries board columns. Phones: a tab per column (with its count) and only the picked
 * column is shown, so staff don't scroll past Unassigned to reach Delivered.
 * Tablets and laptops: every column, as before (the tabs are hidden).
 * `children`: one element per column, in the same order as `columns`.
 */
export function ColumnTabs({ columns, className, children }: { columns: Column[]; className: string; children: React.ReactNode }) {
  const [picked, setPicked] = useState<string | null>(null);
  // The last tab picked on this phone (a convenience only; falls back to the first column).
  useEffect(() => {
    try {
      setPicked(localStorage.getItem(STORE));
    } catch {}
  }, []);
  // A filter (e.g. Delivered only) can drop the picked column: show the first one then.
  const active = columns.some((c) => c.key === picked) ? picked : columns[0]?.key;
  const pick = (key: string) => {
    setPicked(key);
    try {
      localStorage.setItem(STORE, key);
    } catch {}
  };
  const items = Children.toArray(children);

  return (
    <>
      {columns.length > 1 && (
        <div role="tablist" className="mb-3 flex gap-1 rounded-xl bg-slate-100 p-1 sm:hidden">
          {columns.map((c) => {
            const on = c.key === active;
            return (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => pick(c.key)}
                className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] font-medium leading-tight transition ${
                  on ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                }`}
              >
                <span className="flex items-center gap-1">
                  <span className={`size-1.5 shrink-0 rounded-full ${c.dot}`} />
                  <span className="text-sm font-semibold tabular-nums">{c.count}</span>
                </span>
                <span className="w-full truncate text-center">{c.label}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className={className}>
        {/* display: contents keeps the tablet/laptop layout exactly as it was. */}
        {items.map((child, i) => (
          <div key={columns[i]?.key ?? i} className={columns[i]?.key === active ? "contents" : "contents max-sm:hidden"}>
            {child}
          </div>
        ))}
      </div>
    </>
  );
}
