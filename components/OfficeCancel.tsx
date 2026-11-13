"use client";

import { useState, useTransition } from "react";
import { markDoCancelled, undoDoCancelled } from "@/app/actions";
import { useStaffT } from "@/components/StaffLang";

/**
 * DO popup: "Mark cancelled" for an AutoCount DO the sync missed being cancelled, or Undo once marked.
 * Shown to the DO's own branch and admins (app/actions/deliveries.ts markDoCancelled).
 */
export function OfficeCancel({ doId, doNo, reason }: { doId: string; doNo: string; reason: string | null }) {
  const [why, setWhy] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = useStaffT();
  const C = t.officeCancel;

  function run(fn: () => Promise<unknown>) {
    setError(null);
    start(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : t.couldntSave);
      }
    });
  }

  if (reason !== null) {
    return (
      <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3">
        <p className="text-rose-800">
          <span className="mr-1.5 rounded bg-rose-600 px-1.5 text-xs font-bold text-white">{C.cancelled}</span>
          {C.by(reason)}
        </p>
        <button type="button" disabled={pending} onClick={() => run(() => undoDoCancelled(doId))} className="btn-secondary py-1.5 text-xs">
          {pending ? C.marking : C.undo}
        </button>
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    );
  }

  return (
    <details className="rounded-xl border border-slate-200 p-3">
      <summary className="cursor-pointer font-medium text-slate-600">{C.heading}</summary>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-slate-500">{C.hint}</p>
        <input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={200} placeholder={C.reason} aria-label={C.reason} className="input py-2" />
        <button
          type="button"
          disabled={pending || !why.trim()}
          onClick={() => confirm(C.confirm(doNo)) && run(() => markDoCancelled(doId, why))}
          className="btn bg-rose-600 py-1.5 text-xs text-white hover:bg-rose-700"
        >
          {pending ? C.marking : C.mark}
        </button>
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    </details>
  );
}
