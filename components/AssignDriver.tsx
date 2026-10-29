"use client";

import { useTransition } from "react";
import { assignDriver } from "@/app/actions";
import { driverLabel } from "@/lib/format";

/** Pick a driver, or "O/C" when the customer collects at the store. */
export function AssignDriver({
  doId,
  driverId,
  isOc = false,
  drivers,
  driverName = "Current driver",
}: {
  doId: string;
  driverId: string | null;
  isOc?: boolean;
  driverName?: string;
  drivers: { id: string; full_name: string; lorry_no: string | null }[];
}) {
  const [pending, start] = useTransition();
  // Keep the current driver pickable even when they're not in the list (e.g. another branch's driver),
  // otherwise the select falls back to "Choose driver…" and can't be changed back to unassigned.
  const current = driverId && !drivers.some((d) => d.id === driverId) ? driverName : null;
  return (
    <select
      disabled={pending}
      defaultValue={isOc ? "oc" : (driverId ?? "")}
      onChange={(e) => {
        const fd = new FormData();
        fd.set("do_id", doId);
        fd.set("driver_id", e.target.value);
        start(() => assignDriver(fd));
      }}
      className="input py-1.5 text-xs"
    >
      <option value="">Choose driver…</option>
      {current && <option value={driverId!}>{current}</option>}
      {drivers.map((d) => (
        <option key={d.id} value={d.id}>{driverLabel(d)}</option>
      ))}
      <option value="oc">O/C (customer collects)</option>
    </select>
  );
}
