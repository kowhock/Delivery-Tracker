"use client";

import { useState, useTransition } from "react";
import { setStaffAccess } from "@/app/actions";
import { STAFF_ACCESS, type StaffAccess } from "@/lib/access";

/** One dispatcher's tick for one permission on Admin access. */
export function StaffAccessToggle({ profileId, access, allowed }: { profileId: string; access: StaffAccess; allowed: boolean }) {
  const [on, setOn] = useState(allowed);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
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
              await setStaffAccess(profileId, access, next);
            } catch (err) {
              setOn(!next);
              setError(err instanceof Error ? err.message : "Could not save");
            }
          });
        }}
        className="size-4"
      />
      {STAFF_ACCESS[access]}
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </label>
  );
}
