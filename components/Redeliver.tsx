"use client";

import { useState, useTransition } from "react";
import { redeliver } from "@/app/actions";

/** Failed DO: send it out again. It moves back to Assigned / Unassigned, where driver, date and time can be changed. */
export function Redeliver({ doId }: { doId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              await redeliver(doId);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Couldn't save — try again.");
            }
          })
        }
        className="btn-primary w-full py-1.5 text-xs disabled:opacity-50"
      >
        {pending ? "Saving…" : "↻ Redeliver"}
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </>
  );
}
