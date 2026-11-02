"use client";

import { useState, useTransition } from "react";
import { setSdoGoods } from "@/app/actions";

/** One dispatcher's tick on Special order access. */
export function SdoGoodsToggle({ profileId, name, branch, allowed }: { profileId: string; name: string; branch: string | null; allowed: boolean }) {
  const [on, setOn] = useState(allowed);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="flex cursor-pointer items-center gap-3 px-5 py-3">
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          setError(null);
          start(async () => {
            try {
              await setSdoGoods(profileId, next);
            } catch (err) {
              setOn(!next);
              setError(err instanceof Error ? err.message : "Could not save");
            }
          });
        }}
        className="size-4"
      />
      <span className="flex-1 text-sm font-medium">{name}</span>
      {branch && <span className="text-xs text-slate-500">{branch}</span>}
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </label>
  );
}
