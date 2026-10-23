"use client";

import { useEffect, useState } from "react";

/** "AutoCount synced 2 min ago", kept current every 15 seconds. */
export function SyncAge({ syncedAt }: { syncedAt: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15e3);
    return () => clearInterval(t);
  }, []);
  // Rendered on the server without a clock, so the first paint matches.
  if (now === null) return <span>AutoCount synced</span>;

  const ago = Math.max(0, Math.round((now - new Date(syncedAt).getTime()) / 60e3));
  const at = new Date(syncedAt).toLocaleTimeString("en-MY", { timeZone: "Asia/Kuala_Lumpur", hour: "numeric", minute: "2-digit" });
  return <span title={`Last synced from AutoCount at ${at}`}>AutoCount synced {ago === 0 ? "just now" : `${ago} min ago`}</span>;
}
