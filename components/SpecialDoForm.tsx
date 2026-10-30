"use client";

import Link from "next/link";
import { useState, useTransition, type KeyboardEvent } from "react";
import { BRANCHES, driversForBranch } from "@/lib/branches";
import { NEAR_POINTS } from "@/lib/commission";
import { driverLabel } from "@/lib/format";
import type { DeliveryOrder, Profile } from "@/lib/types";

type Values = Pick<DeliveryOrder, "customer_name" | "address" | "contact_phone" | "delivery_date" | "branch" | "driver_id" | "points" | "instructions"> & Partial<Pick<DeliveryOrder, "helper_branch">>;

/**
 * Enter moves to the next box instead of sending the form, so the office can key in
 * a special DO with just Enter. Shift+Enter still adds a new line in Instructions;
 * Enter on the button at the end saves.
 */
function enterToNext(e: KeyboardEvent<HTMLFormElement>) {
  const el = e.target as HTMLElement;
  if (e.key !== "Enter" || e.shiftKey || el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement) return;
  e.preventDefault();
  const fields = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("input:not([type=hidden]), select, textarea, button"));
  fields[fields.indexOf(el) + 1]?.focus();
}

export function SpecialDoForm({
  action,
  drivers,
  lockedTo,
  values,
  submitLabel,
  onDelete,
}: {
  action: (formData: FormData) => Promise<void>;
  drivers: Pick<Profile, "id" | "full_name" | "lorry_no" | "branch">[];
  /** Dispatchers: the only branches they can pick. */
  lockedTo: string[] | null;
  values: Values;
  submitLabel: string;
  /** Edit page only: deletes the special DO. */
  onDelete?: () => Promise<void>;
}) {
  const [deleting, startDelete] = useTransition();
  const [branch, setBranch] = useState(values.branch ?? lockedTo?.[0] ?? "");
  const [driverId, setDriverId] = useState(values.driver_id ?? "");
  // Only the branch's own drivers. A driver it already had from another branch stays pickable
  // so editing other fields doesn't drop them.
  const shown = driversForBranch(drivers, branch, values.helper_branch);
  const kept = values.driver_id && !shown.some((d) => d.id === values.driver_id) ? drivers.find((d) => d.id === values.driver_id) : undefined;

  return (
    <form action={action} onKeyDown={enterToNext} className="card grid gap-4 p-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label">Deliver to (customer / place)</label>
        <input name="customer_name" required autoFocus defaultValue={values.customer_name} className="input" placeholder="e.g. Stock Transfer DO, Kempas branch, or customer name" />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Delivery address</label>
        <input name="address" defaultValue={values.address ?? ""} className="input" placeholder="Full address — the driver gets Waze / Maps buttons for it" />
      </div>
      <div>
        <label className="label">Contact phone</label>
        <input name="contact_phone" defaultValue={values.contact_phone ?? ""} className="input" placeholder="012-345 6789" />
      </div>
      <div>
        <label className="label">Delivery date</label>
        <input name="delivery_date" type="date" defaultValue={values.delivery_date} required className="input" />
      </div>
      <div>
        <label className="label">Branch</label>
        <select
          name="branch"
          value={branch}
          onChange={(e) => {
            setBranch(e.target.value);
            if (driverId !== values.driver_id && !driversForBranch(drivers, e.target.value, values.helper_branch).some((d) => d.id === driverId)) setDriverId("");
          }}
          className="input"
        >
          {!lockedTo && <option value="">—</option>}
          {BRANCHES.filter((b) => !lockedTo || lockedTo.includes(b.code)).map((b) => <option key={b.code} value={b.code}>{b.code} · {b.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Driver</label>
        <select name="driver_id" value={driverId} onChange={(e) => setDriverId(e.target.value)} className="input">
          <option value="">Assign later</option>
          {kept && <option value={kept.id}>{driverLabel(kept)} (other branch)</option>}
          {shown.map((d) => <option key={d.id} value={d.id}>{driverLabel(d)}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Points for the driver</label>
        <input name="points" type="number" min={0} max={99} step={1} defaultValue={values.points ?? NEAR_POINTS} required className="input" />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Instructions to driver</label>
        <textarea name="instructions" rows={3} defaultValue={values.instructions ?? ""} className="input" placeholder="e.g. Collect 20 bags from supplier first, call Mr Tan on arrival" />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary">{submitLabel}</button>
        <Link href="/deliveries" className="btn-secondary">Cancel</Link>
        {onDelete && (
          <button
            type="button"
            disabled={deleting}
            onClick={() => {
              if (confirm("Delete this special DO? This can't be undone.")) startDelete(() => onDelete());
            }}
            className="btn ml-auto border border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>
    </form>
  );
}
