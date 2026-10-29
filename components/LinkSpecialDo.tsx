"use client";

import { useState, useTransition } from "react";
import { linkSpecialDo } from "@/app/actions";

/** Special DO → type the AutoCount DO number it became once AutoCount was back. */
export function LinkSpecialDo({ doId, doNo }: { doId: string; doNo: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="font-medium text-brand-700 hover:underline">
        Link AutoCount DO
      </button>
    );
  }
  const save = () =>
    start(async () => {
      setError(null);
      try {
        await linkSpecialDo(doId, value);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save — try again.");
      }
    });
  return (
    <span className="mt-1 block w-full space-y-1">
      <span className="flex items-center gap-1.5">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && value.trim() && save()}
          placeholder="e.g. GPD-00045135"
          aria-label={`AutoCount DO number for ${doNo}`}
          className="input min-w-0 flex-1 px-2 py-1 text-xs uppercase"
        />
        <button type="button" disabled={pending || !value.trim()} onClick={save} className="btn-primary px-2.5 py-1 text-xs disabled:opacity-50">
          {pending ? "…" : "Link"}
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)} className="px-1 text-slate-500 hover:text-slate-900">✕</button>
      </span>
      {error && <span className="block text-rose-600">{error}</span>}
    </span>
  );
}
