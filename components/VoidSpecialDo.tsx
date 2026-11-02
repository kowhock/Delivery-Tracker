"use client";

import { useState, useTransition } from "react";
import { voidSpecialDo } from "@/app/actions";

/** Admin only: void a special order. It stays on record (shown as VOID), it's never deleted. */
export function VoidSpecialDo({ doId, doNo }: { doId: string; doNo: string }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn border border-rose-200 bg-white text-rose-600 hover:bg-rose-50">
        Void special order
      </button>
    );
  }
  return (
    <div className="card space-y-3 border-rose-200 p-5">
      <p className="text-sm text-slate-700">
        Void <b>{doNo}</b>? It stays on record marked VOID, and comes off the driver&apos;s jobs and points. This can&apos;t be undone.
      </p>
      <input value={why} onChange={(e) => setWhy(e.target.value)} className="input" placeholder="Why is it being voided?" autoFocus />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !why.trim()}
          onClick={() =>
            start(async () => {
              setError(null);
              try {
                await voidSpecialDo(doId, why);
                setOpen(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not void it");
              }
            })
          }
          className="btn bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {pending ? "Voiding…" : "Void"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}
