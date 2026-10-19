"use client";

import Link from "next/link";
import { useState } from "react";
import type { Workbook, Worksheet } from "exceljs";

// Printed at the top of the monthly trip form.
const COMPANY_ZH = "高福五金建築材料 (馬) 有限公司";
const COMPANY_EN = "KOW HOCK BUILDING MATERIALS (M) SDN BHD (733832-T)";
const ROWS = 31; // monthly form rows
const BOXES = 12; // DO boxes on one daily form page (2 columns × 6)
const SIGNATURES = ["PREPARED BY", "BRANCH MANAGER", "CONFIRM BY", "APPROVED BY"];
const CHECKS = ["HYDRAULIC OIL", "ENGINE OIL", "WATER LEVEL", "TYRE"];

export type TripDo = { id: string; doNo: string; location: string; timeIn: string; timeBack: string; points: number | null; manual: boolean;
  /** AutoCount address, set only when the office changed the delivery address used for points (`location` is the new one). */
  original: string };
export type TripDay = { date: string; points: number; rm: number; trips: number; lorry: string; missingPoints: number; dos: TripDo[] };

type Props = { driver: string; driverId: string; branch: string; lorry: string; from: string; to: string; days: TripDay[] };

/** 2026-06-29 → 29.06.2026 (or 29/06/2026 with sep "/"). */
const dotted = (iso: string, sep = ".") => iso.split("-").reverse().join(sep);
const slashed = (iso: string) => dotted(iso, "/");
const rm = (n: number) => `RM${n.toFixed(2)}`;

/** Splits DOs into pages of 12; on a page the left column fills first, like the paper form. */
function pages(dos: TripDo[]): (TripDo | undefined)[][][] {
  const out: (TripDo | undefined)[][][] = [];
  for (let i = 0; i < Math.max(dos.length, 1); i += BOXES) {
    const page = dos.slice(i, i + BOXES);
    out.push(Array.from({ length: BOXES / 2 }, (_, r) => [page[r], page[r + BOXES / 2]]));
  }
  return out;
}

export function TripForm(props: Props) {
  const daily = props.from === props.to;
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const day = props.days[0];
  const missing = props.days.reduce((s, x) => s + x.missingPoints, 0);

  async function exportExcel() {
    setBusy(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      if (daily) dailySheet(wb, props);
      else monthlySheet(wb, props, remarks);
      const buf = await wb.xlsx.writeBuffer();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      a.download = `${daily ? "Daily" : "Monthly"} Trip Form - ${props.driver} - ${daily ? props.from : `${props.from} to ${props.to}`}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <span className="mr-auto text-sm text-slate-600">
          <b>{daily ? "Daily" : "Monthly"} trip form</b> · {props.days.reduce((s, x) => s + x.points, 0)} pts ·{" "}
          {rm(props.days.reduce((s, x) => s + x.rm, 0))}
          {!daily && " · type OFF / MC etc. in Remarks before exporting"}
        </span>
        <button type="button" onClick={() => window.print()} className="btn-secondary">
          PDF / Print
        </button>
        <button type="button" disabled={busy} onClick={exportExcel} className="btn-primary">
          {busy ? "Exporting…" : "Excel"}
        </button>
      </div>
      {missing > 0 && (
        <p className="text-sm text-amber-700 print:hidden">
          {missing} delivered DO{missing > 1 ? "s have" : " has"} no points yet — key them in on Driver status, or the totals are short.
        </p>
      )}

      {daily ? (
        pages(day.dos).map((rows, i) => <DailyPage key={i} {...props} day={day} rows={rows} />)
      ) : (
        <MonthlyPage {...props} remarks={remarks} setRemarks={setRemarks} />
      )}
    </div>
  );
}

// ---------- On screen / print (PDF) ----------------------------------

const cell = "border border-black px-1.5 py-1";
const head = `${cell} text-left font-bold uppercase`;

function DailyPage({ branch, driver, lorry, day, rows }: Props & { day: TripDay; rows: (TripDo | undefined)[][] }) {
  return (
    // Printed: a fixed A4-sized block (190×270mm inside the 10mm margins) with the form centred in it.
    <div className="trip-page mx-auto w-full max-w-[190mm] bg-white p-4 text-[11px] text-black shadow print:flex print:h-[270mm] print:w-[190mm] print:max-w-none print:flex-col print:justify-center print:p-0 print:text-[12px] print:shadow-none">
      <div className="flex gap-4">
        <div className="w-[38%] space-y-4">
          <h2 className="text-base font-bold underline">DELIVERY TRIP TRACKING</h2>
          <div className="border-2 border-black px-3 py-3 text-sm font-bold uppercase">Branch&nbsp;&nbsp;{branch}</div>
        </div>
        <table className="flex-1 border-collapse">
          <tbody>
            <tr>
              <th rowSpan={2} className={`${head} w-[22%] text-center`}>Lorry checking</th>
              {CHECKS.map((c) => (
                <th key={c} className={`${head} text-center text-[9px]`}>{c}</th>
              ))}
            </tr>
            <tr>
              {CHECKS.map((c) => (
                <td key={c} className={`${cell} h-6`} />
              ))}
            </tr>
            <tr>
              <th rowSpan={2} className={`${head} text-center text-[9px]`}>Daily trip calculation</th>
              <th className={`${head} text-center`}>Trip</th>
              <th className={`${head} text-center`}>Point</th>
              <th colSpan={2} className={`${head} text-center`}>Amount</th>
            </tr>
            <tr>
              <td className={`${cell} h-6 text-center`}>{day.trips || ""}</td>
              <td className={`${cell} text-center font-semibold`}>{day.points}</td>
              <td colSpan={2} className={`${cell} text-center`}>{rm(day.rm)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <table className="mt-4 w-full border-collapse">
        <tbody>
          <tr>
            <th className={`${head} w-[10%]`}>Date</th>
            <td className={`${cell} w-[14%]`}>{dotted(day.date)}</td>
            <th className={`${head} w-[10%]`}>Driver</th>
            <td className={cell}>{driver}</td>
            <th className={`${head} w-[12%]`}>Lorry no</th>
            <td className={`${cell} w-[18%]`}>{day.lorry || lorry}</td>
          </tr>
        </tbody>
      </table>

      <table className="mt-4 w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[15%]" /><col className="w-[25%]" /><col className="w-[10%]" />
          <col className="w-[15%]" /><col className="w-[25%]" /><col className="w-[10%]" />
        </colgroup>
        {rows.map((pair, r) => (
          <tbody key={r}>
            {FIELDS.map((f, k) => (
              <tr key={f}>
                {pair.map((x, side) => (
                  <DoBoxRow key={side} field={f} row={k} x={x} />
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

const LABELS = { doNo: "DO NO.", location: "LOCATION", timeIn: "TIME IN", timeBack: "TIME BACK" } as const;
type Field = keyof typeof LABELS;
const FIELDS = Object.keys(LABELS) as Field[];

function DoBoxRow({ field, row, x }: { field: Field; row: number; x?: TripDo }) {
  const value = x?.[field] ?? "";
  return (
    <>
      <th className={`${head} h-8 text-[10px] print:h-[8.5mm] print:text-[11px]`}>{LABELS[field]}</th>
      {field === "location" && x?.original ? (
        // Address changed by the office: the AutoCount one on top, the one used for points below.
        <td className={`${cell} py-0.5 leading-tight`} title={`Original: ${x.original}\nUpdated: ${value}`}>
          <div className="truncate text-[9px] text-slate-500 print:text-[10px]">{x.original}</div>
          <div className="line-clamp-2 break-words">{value}</div>
        </td>
      ) : field === "location" ? (
        // Long addresses wrap onto a second line (cut off after that) instead of being cut at one.
        <td className={`${cell} py-0.5 leading-tight`} title={value}>
          <div className="line-clamp-2 break-words">{value}</div>
        </td>
      ) : (
        <td className={`${cell} truncate ${row === 0 ? "font-semibold" : ""}`} title={value}>{value}</td>
      )}
      {row === 0 ? (
        <th className={`${head} text-center text-[10px]`}>Remark</th>
      ) : row === 1 ? (
        <td
          rowSpan={3}
          className={`${cell} text-center text-xl font-semibold ${x?.manual ? "bg-blue-100 print:bg-blue-100" : ""}`}
          title={x?.manual ? "Points keyed in by staff" : undefined}
        >
          {x?.points ?? ""}
        </td>
      ) : null}
    </>
  );
}

function MonthlyPage({
  branch, driver, lorry, from, to, days, driverId, remarks, setRemarks,
}: Props & { remarks: Record<string, string>; setRemarks: (f: (r: Record<string, string>) => Record<string, string>) => void }) {
  const rows = Array.from({ length: ROWS }, (_, i) => days[i]);
  // Tighter rows than the daily form so all 31 days + signatures fit on one A4 page.
  const cell = "border border-black px-1.5 py-0.5 leading-tight";
  return (
    <div className="trip-page mx-auto w-full max-w-[190mm] bg-white p-6 text-[12px] text-black shadow print:max-w-none print:p-0 print:shadow-none">
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center bg-black px-2 py-1 font-bold leading-tight text-white">
          <span className="text-lg tracking-[0.3em]">KH</span>
          <span className="text-[10px]">KOW HOCK</span>
        </div>
        <div>
          <p className="text-base font-bold">{COMPANY_ZH}</p>
          <p className="font-bold">{COMPANY_EN}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-1">
        <span>DATE</span>
        <span className="border-b border-black">: {dotted(from)}&nbsp;&nbsp;<b>TO</b>&nbsp;&nbsp;{dotted(to)}</span>
        <span>DRIVER</span>
        <span className="border-b border-black uppercase">: {driver}</span>
        <span>BRANCH</span>
        <span className="border-b border-black uppercase">: {branch}</span>
        <span>LORRY</span>
        <span className="border-b border-black">: {lorry}</span>
      </div>

      <table className="mt-3 w-full border-collapse border-2 border-black">
        <thead>
          <tr className="bg-slate-300 print:bg-slate-300">
            <th className={`${cell} w-[8%]`}>NO.</th>
            <th className={`${cell} w-[20%]`}>DATE</th>
            <th className={`${cell} w-[18%]`}>TOTAL POINTS</th>
            <th className={`${cell} w-[18%]`}>AMOUNT</th>
            <th className={cell}>REMARKS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x, i) => (
            <tr key={i} className={x && x.points === 0 ? "bg-slate-200 print:bg-slate-200" : ""}>
              <td className={`${cell} text-center`}>{i + 1}</td>
              <td className={`${cell} text-center`}>
                {x ? (
                  <Link href={`?driver=${driverId}&from=${x.date}&to=${x.date}`} className="hover:underline print:no-underline" title="Open this day's daily trip form">
                    {slashed(x.date)}
                  </Link>
                ) : (
                  "-"
                )}
              </td>
              <td className={`${cell} text-center`}>{x?.points ?? 0}</td>
              <td className={`${cell} text-center`}>{rm(x?.rm ?? 0)}</td>
              <td className={`${cell} py-0 text-center`}>
                {x && (
                  <input
                    value={remarks[x.date] ?? ""}
                    onChange={(e) => setRemarks((r) => ({ ...r, [x.date]: e.target.value.toUpperCase() }))}
                    className="w-full bg-transparent py-0.5 leading-tight text-center outline-none focus:bg-brand-50 print:focus:bg-transparent"
                    aria-label={`Remark for ${slashed(x.date)}`}
                  />
                )}
              </td>
            </tr>
          ))}
          <tr className="font-bold">
            <td colSpan={2} className={`${cell} text-center`}>TOTAL</td>
            <td className={`${cell} text-center`}>{days.reduce((s, x) => s + x.points, 0)}</td>
            <td className={`${cell} text-center`}>{rm(days.reduce((s, x) => s + x.rm, 0))}</td>
            <td className="border-l border-black" />
          </tr>
        </tbody>
      </table>

      <div className="mt-10 grid grid-cols-4 gap-6 text-center">
        {SIGNATURES.map((s) => (
          <span key={s} className="border-t border-black pt-1">{s}</span>
        ))}
      </div>
    </div>
  );
}

// ---------- Excel (same layouts) -------------------------------------

const thin = { style: "thin" as const };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const grey = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFD9D9D9" } };
const lightBlue = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFDBEAFE" } }; // points keyed in by staff

/** Writes a value with a border; `merge` = "B3:C3" style range starting at `at`. */
function put(ws: Worksheet, at: string, value: string | number | null, opts: { bold?: boolean; merge?: string; center?: boolean; fill?: boolean; noBorder?: boolean; size?: number } = {}) {
  if (opts.merge) ws.mergeCells(opts.merge);
  const c = ws.getCell(at);
  c.value = value;
  c.font = { bold: opts.bold, size: opts.size ?? 10 };
  c.alignment = { vertical: "middle", horizontal: opts.center ? "center" : "left", wrapText: true };
  if (opts.fill) c.fill = grey;
  if (!opts.noBorder) {
    const cells = opts.merge ? opts.merge.split(":") : [at];
    const [c1, r1] = [cells[0].replace(/\d+/g, ""), Number(cells[0].replace(/\D+/g, ""))];
    const [c2, r2] = [cells[cells.length - 1].replace(/\d+/g, ""), Number(cells[cells.length - 1].replace(/\D+/g, ""))];
    for (let r = r1; r <= r2; r++)
      for (let col = c1.charCodeAt(0); col <= c2.charCodeAt(0); col++) {
        const x = ws.getCell(`${String.fromCharCode(col)}${r}`);
        x.border = border;
        if (opts.fill) x.fill = grey;
      }
  }
}

function setupPage(ws: Worksheet, onePage = false) {
  ws.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: onePage ? 1 : 0, margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
}

function dailySheet(wb: Workbook, p: Props) {
  const day = p.days[0];
  pages(day.dos).forEach((rows, n) => {
    const ws = wb.addWorksheet(n ? `Daily (${n + 1})` : "Daily");
    setupPage(ws);
    ws.columns = [14, 24, 10, 14, 24, 10].map((width) => ({ width }));

    put(ws, "A1", "DELIVERY TRIP TRACKING", { bold: true, merge: "A1:B1", noBorder: true, size: 13 });
    ws.getCell("A1").font = { bold: true, underline: true, size: 13 };
    put(ws, "A3", `BRANCH   ${p.branch.toUpperCase()}`, { bold: true, merge: "A3:B5", size: 12 });

    // Right-hand blocks over columns C–F: lorry checks (ticked by hand), then the day's totals.
    put(ws, "C1", "LORRY CHECKING", { bold: true, merge: "C1:F1", center: true });
    CHECKS.forEach((c, i) => {
      put(ws, `${"CDEF"[i]}2`, c, { bold: true, center: true });
      put(ws, `${"CDEF"[i]}3`, "");
    });
    put(ws, "C4", "DAILY TRIP CALCULATION", { bold: true, merge: "C4:F4", center: true });
    put(ws, "C5", "TRIP", { bold: true, center: true });
    put(ws, "D5", "POINT", { bold: true, center: true });
    put(ws, "E5", "AMOUNT", { bold: true, merge: "E5:F5", center: true });
    put(ws, "C6", day.trips || "", { center: true });
    put(ws, "D6", day.points, { center: true, bold: true });
    put(ws, "E6", rm(day.rm), { merge: "E6:F6", center: true });

    put(ws, "A8", "DATE", { bold: true });
    put(ws, "B8", dotted(day.date));
    put(ws, "C8", "DRIVER", { bold: true });
    put(ws, "D8", p.driver, { merge: "D8:F8" });
    put(ws, "A9", "LORRY NO", { bold: true });
    put(ws, "B9", day.lorry || p.lorry);

    let r = 11;
    for (const pair of rows) {
      const last = r + FIELDS.length - 1;
      pair.forEach((x, side) => {
        const [L, V, R] = side ? ["D", "E", "F"] : ["A", "B", "C"];
        FIELDS.forEach((f, k) => {
          put(ws, `${L}${r + k}`, LABELS[f], { bold: true });
          put(ws, `${V}${r + k}`, f === "location" && x?.original ? `Original: ${x.original}\nUpdated: ${x.location}` : x?.[f] ?? "", { bold: k === 0 });
        });
        put(ws, `${R}${r}`, "REMARK", { bold: true, center: true });
        put(ws, `${R}${r + 1}`, x?.points ?? "", { merge: `${R}${r + 1}:${R}${last}`, center: true, bold: true, size: 14 });
        if (x?.manual) for (let k = r + 1; k <= last; k++) ws.getCell(`${R}${k}`).fill = lightBlue;
      });
      // The location line fits two lines of text, or four when it shows the original and updated address.
      const changed = pair.some((x) => x?.original);
      FIELDS.forEach((f, k) => (ws.getRow(r + k).height = f === "location" ? (changed ? 52 : 28) : 20));
      r += FIELDS.length;
    }
  });
}

function monthlySheet(wb: Workbook, p: Props, remarks: Record<string, string>) {
  const ws = wb.addWorksheet("Monthly");
  setupPage(ws, true);
  ws.columns = [7, 16, 16, 16, 34].map((width) => ({ width }));

  put(ws, "A1", COMPANY_ZH, { bold: true, merge: "A1:E1", noBorder: true, size: 14 });
  put(ws, "A2", COMPANY_EN, { bold: true, merge: "A2:E2", noBorder: true, size: 11 });
  put(ws, "A4", "DATE", { merge: "A4:B4", noBorder: true });
  put(ws, "C4", `: ${dotted(p.from)}  TO  ${dotted(p.to)}`, { merge: "C4:D4", noBorder: true });
  put(ws, "E4", `DRIVER : ${p.driver.toUpperCase()}`, { noBorder: true });
  put(ws, "A5", "BRANCH", { merge: "A5:B5", noBorder: true });
  put(ws, "C5", `: ${p.branch.toUpperCase()}`, { merge: "C5:D5", noBorder: true });
  put(ws, "E5", `LORRY : ${p.lorry}`, { noBorder: true });

  ["NO.", "DATE", "TOTAL POINTS", "AMOUNT", "REMARKS"].forEach((h, i) => put(ws, `${"ABCDE"[i]}7`, h, { bold: true, center: true, fill: true }));
  for (let i = 0; i < ROWS; i++) {
    const x = p.days[i];
    const r = 8 + i;
    const shade = !!x && x.points === 0;
    put(ws, `A${r}`, i + 1, { center: true, fill: shade });
    put(ws, `B${r}`, x ? slashed(x.date) : "-", { center: true, fill: shade });
    put(ws, `C${r}`, x?.points ?? 0, { center: true, fill: shade });
    put(ws, `D${r}`, x?.rm ?? 0, { center: true, fill: shade });
    put(ws, `E${r}`, x ? remarks[x.date] ?? "" : "", { center: true, fill: shade });
    ws.getCell(`D${r}`).numFmt = '"RM"#,##0.00';
    ws.getRow(r).height = 16;
  }
  const t = 8 + ROWS;
  put(ws, `A${t}`, "TOTAL", { bold: true, merge: `A${t}:B${t}`, center: true });
  put(ws, `C${t}`, p.days.reduce((s, x) => s + x.points, 0), { bold: true, center: true });
  put(ws, `D${t}`, p.days.reduce((s, x) => s + x.rm, 0), { bold: true, center: true });
  ws.getCell(`D${t}`).numFmt = '"RM"#,##0.00';

  const s = t + 4;
  // PREPARED BY | BRANCH MANAGER | CONFIRM BY | APPROVED BY, each over a signature line.
  [["A", "B"], ["C", "C"], ["D", "D"], ["E", "E"]].forEach(([a, b], i) => {
    put(ws, `${a}${s}`, SIGNATURES[i], { merge: a === b ? undefined : `${a}${s}:${b}${s}`, center: true, noBorder: true });
    ws.getCell(`${a}${s}`).border = { top: thin };
    if (a !== b) ws.getCell(`${b}${s}`).border = { top: thin };
  });
}
