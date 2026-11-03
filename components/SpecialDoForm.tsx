"use client";

import Link from "next/link";
import { useState, type KeyboardEvent } from "react";
import { BRANCHES, driversForBranch } from "@/lib/branches";
import { NEAR_POINTS } from "@/lib/commission";
import { driverLabel } from "@/lib/format";
import { GOODS_REASONS, RETIRED_REASONS, SPECIAL_REASONS, isPrintReason, usesSpecialOrders, type SpecialReason } from "@/lib/special";
import type { DeliveryOrder, DoItem, Profile } from "@/lib/types";

type Values = Pick<DeliveryOrder, "customer_name" | "address" | "contact_phone" | "delivery_date" | "branch" | "driver_id" | "points" | "instructions"> &
  Partial<Pick<DeliveryOrder, "helper_branch" | "special_reason" | "remarks">>;
type ItemRow = { key: number; description: string; uom: string; qty: string };
let nextKey = 0;
const blankRow = (): ItemRow => ({ key: nextKey++, description: "", uom: "", qty: "" });

/**
 * Enter moves to the next box instead of sending the form, so the office can key in
 * a special DO with just Enter. Shift+Enter still adds a new line in Instructions;
 * Enter on the button at the end saves.
 */
function enterToNext(e: KeyboardEvent<HTMLFormElement>) {
  const el = e.target as HTMLElement;
  if (e.key !== "Enter" || e.shiftKey || el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement) return;
  e.preventDefault();
  const fields = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("input:not([type=hidden]), select, textarea, button:not([data-skip])"));
  fields[fields.indexOf(el) + 1]?.focus();
}

export function SpecialDoForm({
  action,
  drivers,
  lockedTo,
  values,
  submitLabel,
  canGoods = false,
  items = [],
}: {
  action: (formData: FormData) => Promise<void>;
  drivers: Pick<Profile, "id" | "full_name" | "lorry_no" | "branch">[];
  /** Dispatchers: the only branches they can pick. */
  lockedTo: string[] | null;
  values: Values;
  submitLabel: string;
  /** Admin, or a dispatcher an admin allowed: may pick Kurang Hantar (lib/special.ts). */
  canGoods?: boolean;
  /** Edit page: the special order's items so far. */
  items?: Pick<DoItem, "description" | "uom" | "qty">[];
}) {
  const [branch, setBranch] = useState(values.branch ?? lockedTo?.[0] ?? "");
  const [driverId, setDriverId] = useState(values.driver_id ?? "");
  // Only the branch's own drivers. A driver it already had from another branch stays pickable
  // so editing other fields doesn't drop them.
  const shown = driversForBranch(drivers, branch, values.helper_branch);
  const kept = values.driver_id && !shown.some((d) => d.id === values.driver_id) ? drivers.find((d) => d.id === values.driver_id) : undefined;
  // Special orders (reason, items, remark): only the branches in SPECIAL_ORDER_BRANCHES so far.
  const special = usesSpecialOrders(branch);
  const [reason, setReason] = useState(values.special_reason ?? "");
  const withItems = isPrintReason(reason); // Kurang Hantar
  const [rows, setRows] = useState<ItemRow[]>(() =>
    items.length ? items.map((i) => ({ key: nextKey++, description: i.description ?? "", uom: i.uom ?? "", qty: String(i.qty) })) : [blankRow()]
  );
  const setRow = (key: number, patch: Partial<ItemRow>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // Goods reasons only for people allowed to use them; retired reasons never — except the one the SDO already has.
  const reasons = (Object.keys(SPECIAL_REASONS) as SpecialReason[]).filter((r) => r === values.special_reason || ((canGoods || !GOODS_REASONS.includes(r)) && !RETIRED_REASONS.includes(r)));

  return (
    <form action={action} onKeyDown={enterToNext} className="card grid gap-4 p-5 sm:grid-cols-2">
      {special && (
        <div className="sm:col-span-2">
          <label className="label">Reason for this special order</label>
          <select name="special_reason" required value={reason} onChange={(e) => setReason(e.target.value)} className="input">
            <option value="" disabled>Choose a reason…</option>
            {reasons.map((r) => <option key={r} value={r}>{SPECIAL_REASONS[r]}</option>)}
          </select>
        </div>
      )}
      <div className="sm:col-span-2">
        <label className="label">Deliver to (customer / place)</label>
        <input name="customer_name" required autoFocus defaultValue={values.customer_name} className="input" placeholder="e.g. Stock Transfer DO, Kempas branch, or customer name" />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Delivery address</label>
        <input name="address" defaultValue={values.address ?? ""} className="input" />
      </div>
      <div>
        <label className="label">Contact phone</label>
        <input name="contact_phone" defaultValue={values.contact_phone ?? ""} className="input" />
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
      {/* Anyone who can make / edit the special DO sets its points here (Edit points access is for Driver status). */}
      <div>
        <label className="label">Points for the driver</label>
        <input name="points" type="number" min={0} max={99} step={1} defaultValue={values.points ?? NEAR_POINTS} required className="input" />
      </div>
      <div className="sm:col-span-2">
        {/* One Remark for every special DO: shown to the driver, printed on the Kurang Hantar Delivery Order. Saved in
            `instructions`, which the AutoCount sync never touches (it overwrites `remarks` once linked). */}
        <label className="label">Remark</label>
        <textarea name="instructions" rows={3} defaultValue={values.instructions ?? values.remarks ?? ""} className="input" />
      </div>
      {special && withItems && (
        <>
          <div className="sm:col-span-2">
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_6rem_6rem_2rem] gap-2 text-xs font-medium text-slate-500">
                <span>Item name</span>
                <span>UOM</span>
                <span>Quantity</span>
                <span />
              </div>
              {rows.map((r) => (
                <div key={r.key} className="grid grid-cols-[1fr_6rem_6rem_2rem] gap-2">
                  <input name="item_name" value={r.description} onChange={(e) => setRow(r.key, { description: e.target.value })} className="input" placeholder="e.g. Batu Bata" />
                  <input name="item_uom" value={r.uom} onChange={(e) => setRow(r.key, { uom: e.target.value })} className="input" placeholder="NOS" />
                  <input name="item_qty" type="number" min={1} step={1} inputMode="numeric" value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} className="input" placeholder="1" />
                  <button
                    type="button"
                    aria-label="Remove item"
                    data-skip
                    tabIndex={-1}
                    onClick={() => setRows((all) => (all.length > 1 ? all.filter((x) => x.key !== r.key) : [blankRow()]))}
                    className="text-lg text-slate-400 hover:text-rose-600"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setRows((all) => [...all, blankRow()])} className="text-sm font-medium text-brand-700 hover:underline">
                + Add item
              </button>
            </div>
          </div>
        </>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary">{submitLabel}</button>
        <Link href="/deliveries" className="btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}
