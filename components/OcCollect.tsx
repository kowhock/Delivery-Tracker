"use client";

import { useState, useTransition } from "react";
import { setCollected } from "@/app/actions";
import { fmtDateTime } from "@/lib/format";

/** Now in Malaysia time, as a datetime-local value ("2026-10-29T15:30"). */
const nowMY = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16);

/** O/C card: one tap marks it collected now; "Set time" records an earlier collection. Undo puts it back. */
export function OcCollect({ doId, collectedAt }: { doId: string; collectedAt: string | null }) {
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(false);
  const [at, setAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = (collected: boolean, when: string | null = null) =>
    start(async () => {
      setError(null);
      try {
        await setCollected(doId, collected, when);
        setPicking(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save — try again.");
      }
    });
  const err = error && <p className="text-xs text-rose-600">{error}</p>;

  if (collectedAt) {
    return (
      <>
      <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-2 py-1.5 text-xs">
        <span className="font-medium text-emerald-700">✅ Collected {fmtDateTime(collectedAt)}</span>
        <button disabled={pending} onClick={() => save(false)} className="text-slate-500 hover:text-slate-900 hover:underline disabled:opacity-50">
          Undo
        </button>
      </div>
      {err}
      </>
    );
  }

  if (picking) {
    return (
      <>
      <div className="flex items-center gap-1.5">
        <input
          type="datetime-local"
          autoFocus
          max={nowMY()}
          value={at}
          onChange={(e) => setAt(e.target.value)}
          aria-label="Collected at"
          className="input min-w-0 flex-1 py-1.5 text-xs"
        />
        <button disabled={pending || !at} onClick={() => save(true, at)} className="btn-primary px-2.5 py-1.5 text-xs disabled:opacity-50">
          Save
        </button>
        <button disabled={pending} onClick={() => setPicking(false)} className="px-1 text-xs text-slate-500 hover:text-slate-900">
          ✕
        </button>
      </div>
      {err}
      </>
    );
  }

  return (
    <>
    <div className="flex items-center gap-1.5">
      <button disabled={pending} onClick={() => save(true)} className="btn-primary flex-1 py-1.5 text-xs disabled:opacity-50">
        {pending ? "Saving…" : "✓ Collected"}
      </button>
      <button
        disabled={pending}
        onClick={() => {
          setAt(nowMY());
          setPicking(true);
        }}
        title="Collected earlier? Set the time"
        className="btn-secondary px-2.5 py-1.5 text-xs disabled:opacity-50"
      >
        🕒 Set time
      </button>
    </div>
    {err}
    </>
  );
}
