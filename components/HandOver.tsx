"use client";

import { useState, useTransition } from "react";
import { setHelperBranch } from "@/app/actions";
import { BRANCHES, branchName } from "@/lib/branches";

export type HandOverInfo = { branch: string; helper: string | null; hasDriver: boolean };

/**
 * "Assign other branch" in the DO popup: that branch then sees the DO and its drivers are the
 * ones offered for it. Shown to the DO's own branch only; it needs no driver on the DO.
 */
export function HandOver({ doId, branch, helper, hasDriver }: { doId: string } & HandOverInfo) {
  const [choosing, setChoosing] = useState(false);
  const [to, setTo] = useState(helper ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(next: string | null) {
    setError(null);
    start(async () => {
      try {
        await setHelperBranch(doId, next);
        setChoosing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save — try again.");
      }
    });
  }

  if (!choosing) {
    return (
      <div className="min-w-0">
        <button type="button" onClick={() => setChoosing(true)} className="btn-secondary">
          {helper ? `${branchName(helper)} delivering · change` : "Assign other branch"}
        </button>
        {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-1.5">
      {hasDriver ? (
        <p className="text-xs text-amber-700">Take the driver off this DO first, then assign it to another branch.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Branch to deliver this DO" className="input w-auto py-1.5">
            <option value="" disabled>Choose branch…</option>
            {BRANCHES.filter((b) => b.store && b.code !== branch).map((b) => (
              <option key={b.code} value={b.code}>{b.name}</option>
            ))}
          </select>
          <button type="button" disabled={pending || !to || to === helper} onClick={() => save(to)} className="btn-primary">
            {pending ? "Saving…" : "Assign"}
          </button>
          {helper && (
            <button type="button" disabled={pending} onClick={() => save(null)} className="text-sm font-medium text-rose-600 hover:underline">
              Take back
            </button>
          )}
        </div>
      )}
      <button type="button" onClick={() => setChoosing(false)} className="text-xs text-slate-500 hover:text-slate-900">
        Cancel
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
