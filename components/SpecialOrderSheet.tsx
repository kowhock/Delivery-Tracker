"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { recordSpecialPrint } from "@/app/actions";
import { branchName } from "@/lib/branches";
import { driverLabel, fmtQty } from "@/lib/format";
import { SPECIAL_REASONS, isSpecialReason } from "@/lib/special";
import type { DoItem } from "@/lib/types";

// Company details as on the printed Delivery Order. Check against the real letterhead before going live.
const COMPANY = {
  nameZh: "高福五金建築材料（馬）有限公司",
  name: "KOW HOCK BUILDING MATERIALS (M) SDN. BHD.",
  regNo: "200601014081 (733832-T)",
  tin: "Tin Number: C 12109794030   MSIC Code: 47520",
  hq: "HQ: No. 47, Jalan NB2 2/2, Taman Nusa Bestari 2, 81300 Skudai, Johor Bahru, Johor, Malaysia.",
  contact: "Tel: 07-556 9833, 558 9833, 558 2833   Email: kowhock9833@yahoo.com.sg",
};

export type SheetOrder = {
  id: string;
  do_no: string;
  customer_name: string;
  address: string | null;
  contact_phone: string | null;
  delivery_date: string;
  branch: string | null;
  remarks: string | null;
  instructions: string | null;
  special_reason: string | null;
  print_count: number;
  printed_at: string | null;
  created_at: string;
  do_items?: DoItem[];
  driver?: { full_name: string; lorry_no: string | null } | null;
  creator?: { full_name: string } | null;
  printer?: { full_name: string } | null;
};

const TZ = "Asia/Kuala_Lumpur";
const dmy = (d: string) => new Date(d.length === 10 ? d + "T00:00:00+08:00" : d).toLocaleDateString("en-GB", { timeZone: TZ });
const dmyTime = (d: string) => new Date(d).toLocaleString("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * The Tumpang Barang sheet, printed as a Delivery Order like the company's Delivery Order. Print records the print
 * first (after that only authorised people can edit it), then opens the browser's print dialog. Copies after the
 * first say REPRINT.
 */
export function SpecialOrderSheet({ order, printedByName }: { order: SheetOrder; printedByName: string }) {
  const [count, setCount] = useState(order.print_count);
  const [printedNow, setPrintedNow] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // What the next (or just made) copy is.
  const copyNo = printedNow ? count : count + 1;
  const reprint = copyNo > 1;
  const items = order.do_items ?? [];
  const reason = isSpecialReason(order.special_reason) ? SPECIAL_REASONS[order.special_reason] : "—";

  const print = () =>
    start(async () => {
      setError(null);
      try {
        const n = await recordSpecialPrint(order.id);
        setCount(n);
        setPrintedNow(new Date().toISOString());
        // Let the REPRINT mark / print time render before the dialog opens.
        setTimeout(() => window.print(), 50);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not print");
      }
    });

  return (
    <div className="space-y-4">
      <style>{`@page { size: A4; margin: 10mm; } @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/deliveries/special/${order.id}`} className="text-sm text-slate-500 hover:text-slate-900">← {order.do_no}</Link>
        <div className="flex items-center gap-3">
          <button type="button" onClick={print} disabled={pending} className="btn-primary">
            {pending ? "Preparing…" : count > 0 ? "Reprint" : "Print"}
          </button>
        </div>
        {error && <p className="w-full text-sm text-rose-600">{error}</p>}
      </div>

      <article className="relative mx-auto flex min-h-[277mm] max-w-[210mm] flex-col bg-white p-[8mm] text-[11px] leading-snug text-black shadow print:min-h-[277mm] print:p-0 print:shadow-none">
        {reprint && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
            <span className="-rotate-30 text-[90px] font-black tracking-widest text-black/10">REPRINT</span>
          </div>
        )}

        {/* Letterhead */}
        <header className="flex items-start gap-4">
          <div className="shrink-0 text-center">
            <img src="/kowhock-logo-full.png" alt="Kow Hock" className="h-[22mm] w-auto" />
            <p className="mt-0.5 text-[8px] font-semibold">{COMPANY.regNo}</p>
          </div>
          <div className="min-w-0 pt-1">
            <p className="text-[20px] font-bold leading-tight tracking-wider">{COMPANY.nameZh}</p>
            <p className="text-[15px] font-bold leading-tight">{COMPANY.name}</p>
            <p className="text-[8.5px] font-semibold">{COMPANY.tin}</p>
            <p className="text-[8.5px]">{COMPANY.hq}</p>
            <p className="text-[8.5px]">{COMPANY.contact}</p>
          </div>
        </header>

        {/* Customer · title · number */}
        <section className="mt-4 grid grid-cols-[1fr_42%] gap-4">
          <div className="min-h-[30mm] rounded-md border border-black px-3 py-2 text-[12px]">
            <p className="font-semibold">{order.customer_name}</p>
            {order.address && <p className="whitespace-pre-line">{order.address}</p>}
            <p className="mt-2">Tel: {order.contact_phone ?? ""}</p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-[20px] font-bold leading-tight tracking-wide">
                DELIVERY
                <br />
                ORDER
              </h1>
              <div className="text-right text-[13px] font-semibold">
                <p>{order.do_no}</p>
                <p className="font-normal">{dmy(order.delivery_date)}</p>
                {reprint && <p className="mt-1 inline-block rounded border border-black px-1.5 text-[10px] font-bold">REPRINT · COPY {copyNo}</p>}
              </div>
            </div>
            <div className="flex-1 rounded-md border border-black px-3 py-2 text-[11.5px]">
              <p><span className="inline-block w-20 text-slate-600">Reason</span>: <b>{reason}</b></p>
              <p><span className="inline-block w-20 text-slate-600">Branch</span>: {order.branch ? `${branchName(order.branch)} (${order.branch})` : "—"}</p>
              <p><span className="inline-block w-20 text-slate-600">Delivery date</span>: {dmy(order.delivery_date)}</p>
            </div>
          </div>
        </section>

        {/* Reference row */}
        <section className="mt-3 grid grid-cols-3 rounded-md border border-black text-center text-[11px]">
          <div className="border-r border-black">
            <p className="border-b border-black py-0.5 font-bold">D/O NO.</p>
            <p className="py-1">{order.do_no}</p>
          </div>
          <div className="border-r border-black">
            <p className="border-b border-black py-0.5 font-bold">DRIVER</p>
            <p className="py-1">{order.driver ? driverLabel(order.driver) : "—"}</p>
          </div>
          <div>
            <p className="border-b border-black py-0.5 font-bold">CREATED BY</p>
            <p className="py-1">{order.creator?.full_name ?? "—"}</p>
          </div>
        </section>

        {/* Items */}
        <table className="mt-3 w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-neutral-800 text-white">
              <th className="w-12 rounded-l-md py-1.5 font-semibold">NO.</th>
              <th className="py-1.5 text-left font-semibold">DESCRIPTION</th>
              <th className="w-28 py-1.5 text-right font-semibold">QUANTITY</th>
              <th className="w-24 rounded-r-md py-1.5 pl-4 text-left font-semibold">UOM</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id}>
                <td className="py-1 text-center">{i + 1}.</td>
                <td className="py-1">{it.description}</td>
                <td className="py-1 text-right">{fmtQty(it.qty)}</td>
                <td className="py-1 pl-4">{it.uom}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex-1" />

        {/* Remarks / instructions */}
        <section className="mt-4 space-y-1 text-[12px]">
          {/* The form's Remark is saved in instructions; remarks only on SDOs from before that. */}
          <p className="flex gap-2">
            <b className="shrink-0">REMARKS:</b>
            <span className="whitespace-pre-line">{[order.instructions, order.remarks].filter(Boolean).join("\n")}</span>
          </p>
        </section>

        {/* Signatures, like the Delivery Order */}
        <footer className="mt-4 grid grid-cols-3 items-end gap-4 border-t border-black pt-3 text-[11px]">
          <div>
            <p className="font-semibold">E. &amp; O. E.</p>
            <p className="font-semibold">for {COMPANY.name}</p>
            <div className="mt-14 border-t border-black pt-1 text-center font-semibold">Authorised Signature</div>
          </div>
          <div className="divide-y divide-black rounded-md border border-black">
            {[
              ["Driver", order.driver?.full_name ?? ""],
              ["Time In", ""],
              ["Time Out", ""],
              ["Time Back", ""],
              ["Store Check", ""],
            ].map(([label, value]) => (
              <p key={label} className="flex px-2 py-1.5">
                <b className="w-20 shrink-0">{label}</b>: <span className="ml-1">{value}</span>
              </p>
            ))}
          </div>
          <div className="text-center">
            <p className="font-semibold">Received in good order</p>
            <div className="mt-20 border-t border-black pt-1 font-semibold">Signature / Name / Company Chop</div>
          </div>
        </footer>

        <p className="mt-3 text-[9px] text-neutral-600">
          Created by {order.creator?.full_name ?? "—"} on {dmyTime(order.created_at)}
          {order.printed_at && ` · First printed ${dmyTime(order.printed_at)}${order.printer ? ` by ${order.printer.full_name}` : ""}`}
          {printedNow && ` · This copy printed ${dmyTime(printedNow)} by ${printedByName}`}
          {` · Copy ${copyNo}`}
        </p>
      </article>
    </div>
  );
}
