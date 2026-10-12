"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSoPreview, type SoPreview } from "@/app/actions";
import { SoBadge } from "./StatusBadge";
import { branchName } from "@/lib/branches";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/format";

/** An SO number that opens the SO in a popup instead of going to the SO page (used for dispatchers). */
export function SoPopup({ soId, soNo }: { soId: string; soNo: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [isOpen, setOpen] = useState(false);
  const [data, setData] = useState<SoPreview | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "missing" | "error">("idle");

  async function open(e: React.MouseEvent) {
    // Cards on Driver status are draggable/clickable; keep the tap to this link.
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
    if (data) return;
    setState("loading");
    try {
      const res = await getSoPreview(soId);
      setData(res);
      setState(res ? "idle" : "missing");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    if (isOpen) dialog.current?.showModal();
  }, [isOpen]);

  const so = data?.so;
  return (
    <>
      <button type="button" onClick={open} draggable={false} className="text-brand-700 hover:underline">
        {soNo}
      </button>
      {/* Portalled to <body>: the link sits inside a <p>, which can't hold the popup's headings and lists. */}
      {isOpen &&
        createPortal(
          <dialog
            ref={dialog}
            onClose={() => setOpen(false)}
            // Clicking the dark backdrop closes it.
            onClick={(e) => {
              e.stopPropagation();
              if (e.target === dialog.current) dialog.current?.close();
            }}
            // React events still bubble from the portal to the card; keep them here.
            onPointerDown={(e) => e.stopPropagation()}
            onDragStart={(e) => e.stopPropagation()}
            className="m-auto w-[min(32rem,calc(100vw-2rem))] cursor-auto rounded-2xl p-0 text-left text-sm text-slate-800 shadow-xl backdrop:bg-slate-900/40"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight">{soNo}</h2>
                  {so && <SoBadge status={so.status} />}
                </div>
                {so && (
                  <p className="text-slate-600">
                    {so.customer_name}
                    {so.debtor_code && <span className="text-slate-400"> · {so.debtor_code}</span>}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dialog.current?.close()}
                aria-label="Close"
                className="text-xl leading-none text-slate-400 hover:text-slate-900"
              >
                ×
              </button>
            </div>

            <div className="max-h-[70dvh] overflow-y-auto px-5 py-4">
              {state === "loading" && <p className="text-slate-500">Loading…</p>}
              {state === "missing" && <p className="text-slate-500">This sales order isn&apos;t available.</p>}
              {state === "error" && <p className="text-rose-600">Couldn&apos;t load this sales order. Try again.</p>}
              {so && data && (
                <div className="space-y-4">
                  {so.remarks && (
                    <p className="rounded-xl bg-amber-50 p-3 text-amber-900">
                      <span className="font-medium">Remark: </span>
                      {so.remarks}
                    </p>
                  )}
                  <dl className="grid grid-cols-2 gap-3">
                    <Field label="Order date" value={fmtDate(so.so_date)} />
                    <Field label="Total" value={fmtMoney(so.total)} />
                    <Field label="Delivery phone" value={so.phone} />
                    <Field label="Agent" value={so.agent} />
                    <Field label="Sales location" value={so.branch ? branchName(so.branch) : so.sales_location} />
                    <Field label="Transfer to (DO)" value={so.transfer_to} />
                    <div className="col-span-2">
                      <Field label="Delivery address" value={so.address} />
                    </div>
                  </dl>
                  <div>
                    <h3 className="mb-1 font-semibold">Items</h3>
                    {data.items.length === 0 ? (
                      <p className="text-slate-500">No item lines imported.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                        {data.items.map((l) => (
                          <li key={l.id} className="flex items-start justify-between gap-3 px-3 py-2">
                            <div>
                              <div className="font-medium">{l.item_code}</div>
                              {l.description && <div className="text-xs text-slate-500">{l.description}</div>}
                            </div>
                            <span className="whitespace-nowrap tabular-nums">
                              {fmtQty(l.qty)} {l.uom}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5">{value || "—"}</dd>
    </div>
  );
}
