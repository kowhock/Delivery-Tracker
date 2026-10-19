"use client";

import { useState } from "react";
import { BRANCHES } from "@/lib/branches";

type Driver = { id: string; full_name: string; branch: string | null };

/** Branch dropdown, then a driver dropdown listing only that branch's drivers. */
export function BranchDriverPicker({ drivers, driverId }: { drivers: Driver[]; driverId?: string }) {
  const branches = BRANCHES.filter((b) => drivers.some((d) => d.branch === b.code));
  const noBranch = drivers.some((d) => !d.branch);
  const [branch, setBranch] = useState(drivers.find((d) => d.id === driverId)?.branch ?? branches[0]?.code ?? "");
  const [driver, setDriver] = useState(driverId ?? "");
  const shown = drivers.filter((d) => (d.branch ?? "") === branch);

  return (
    <>
      <select
        value={branch}
        onChange={(e) => {
          setBranch(e.target.value);
          setDriver(drivers.find((d) => (d.branch ?? "") === e.target.value)?.id ?? "");
        }}
        aria-label="Branch"
        className="input w-auto"
      >
        {branches.map((b) => (
          <option key={b.code} value={b.code}>{b.name}</option>
        ))}
        {noBranch && <option value="">No branch</option>}
      </select>
      <select name="driver" value={driver} onChange={(e) => setDriver(e.target.value)} aria-label="Driver" className="input w-auto">
        {shown.map((d) => (
          <option key={d.id} value={d.id}>{d.full_name}</option>
        ))}
      </select>
    </>
  );
}
