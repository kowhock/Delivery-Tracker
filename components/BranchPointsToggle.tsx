"use client";

import { useState, useTransition } from "react";
import { setBranchPoints } from "@/app/actions";

/** One branch's "Points" tick on Admin access: off = its drivers earn 0 points for its DOs. */
export function BranchPointsToggle({ branch, name, on: initial }: { branch: string; name: string; on: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  return (
    <label className="flex cursor-pointer items-center gap-3 px-5 py-3 text-sm">
      <span className="flex-1 font-medium">{name}</span>
      {note && <span className={`text-xs ${note.error ? "text-rose-600" : "text-slate-500"}`}>{note.text}</span>}
      <span className={`text-xs font-semibold ${on ? "text-emerald-700" : "text-slate-400"}`}>{on ? "Points on" : "Points off"}</span>
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          if (!next && !confirm(`Turn points off for ${name}? Its DOs not delivered yet go to 0 points.`)) return;
          setOn(next);
          setNote(null);
          start(async () => {
            try {
              const changed = await setBranchPoints(branch, next);
              setNote({ error: false, text: changed ? `${changed} open DO${changed === 1 ? "" : "s"} updated` : "Saved" });
            } catch (err) {
              setOn(!next);
              setNote({ error: true, text: err instanceof Error ? err.message : "Could not save" });
            }
          });
        }}
        className="size-4"
      />
    </label>
  );
}
