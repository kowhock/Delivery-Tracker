"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { endMaintenance, saveLorry, setLorryBorrow, setLorryDriver, setMaintenance } from "@/app/actions";
import { LORRY_BRANCHES, branchName, canPlan, userBranches } from "@/lib/branches";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { STAFF_DICT, type StaffDict } from "@/lib/i18n-staff";
import { inMaintenance, type Lorry } from "@/lib/types";
import { useStaffT } from "@/components/StaffLang";

type Driver = { id: string; full_name: string; branch: string | null };
/** A driver's jobs today: DOs out for delivery now, assigned ones still to go, delivered ones. */
export type LorryJobs = { onRoad: string[]; left: number; delivered: number };
export type LorryEvent = { id: number; note: string; created_at: string; actor: { full_name: string } | null };

// The screen follows the EN / 中文 switch; the Excel export is always in English.
type LorryWords = StaffDict["lorries"];
const EN = STAFF_DICT.en;

/** Popup shell: native <dialog>, portalled to <body>; clicking the backdrop closes it. */
function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useStaffT();
  useEffect(() => ref.current?.showModal(), []);
  return createPortal(
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl p-0 text-left text-sm text-slate-800 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-slate-500">{subtitle}</p>}
        </div>
        <button type="button" onClick={() => ref.current?.close()} aria-label={t.close} className="text-xl leading-none text-slate-400 hover:text-slate-900">
          ×
        </button>
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </dialog>,
    document.body
  );
}

/** What a lorry is doing today, as text and badge colours. */
function lorryStatus(lorry: Lorry, jobs: LorryJobs | undefined, today: string, L: LorryWords, locale: string): [string, string] {
  return inMaintenance(lorry, today)
    ? [L.maintenanceUntil(lorry.maintenance_to ? fmtDate(lorry.maintenance_to, locale) : null), "bg-amber-100 text-amber-800"]
    : lorry.is_trailer
      ? [L.trailerAll, "bg-violet-100 text-violet-800"]
      : !lorry.driver_id
      ? [L.spare, "bg-slate-100 text-slate-600"]
      : jobs?.onRoad.length
        ? [L.onRoad(jobs.onRoad.join(", ")), "bg-blue-100 text-blue-800"]
        : jobs?.left
          ? [L.jobsLeft(jobs.left), "bg-indigo-50 text-indigo-700"]
          : jobs?.delivered
            ? [L.doneToday(jobs.delivered), "bg-emerald-100 text-emerald-800"]
            : [L.available, "bg-emerald-50 text-emerald-700"];
}

function StatusBadge({ lorry, jobs, today }: { lorry: Lorry; jobs?: LorryJobs; today: string }) {
  const t = useStaffT();
  const [text, look] = lorryStatus(lorry, jobs, today, t.lorries, t.locale);
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${look}`}>{text}</span>;
}

type View = "grid" | "list";
const VIEW_KEY = "lorries-view";

/** Lorry numbers in number order: 2 before 10, "46A" after "46". */
const byLorryNo = (a: Lorry, b: Lorry) => a.lorry_no.localeCompare(b.lorry_no, undefined, { numeric: true, sensitivity: "base" });

export function Lorries({
  lorries,
  allLorries,
  drivers,
  jobs,
  events,
  today,
  branch,
  lockedBranches,
  myBranch,
}: {
  lorries: Lorry[];
  allLorries: Lorry[]; // every branch's, to tell which lorry a driver is on now
  drivers: Driver[];
  jobs: Record<string, LorryJobs>;
  events: Record<string, LorryEvent[]>;
  today: string;
  branch: string | null;
  lockedBranches: string[] | null; // dispatchers: the branches they can put a lorry under
  myBranch: string | null; // the user's branch(es): owners edit a lorry, a branch it's borrowed to only picks its driver
}) {
  const t = useStaffT();
  const L = t.lorries;
  const date = (d: string) => fmtDate(d, t.locale);
  const [editing, setEditing] = useState<Lorry | "new" | null>(null);
  const [servicing, setServicing] = useState<Lorry | null>(null);
  const [borrowing, setBorrowing] = useState<Lorry | null>(null);
  const [takingBack, setTakingBack] = useState<Lorry | null>(null);
  const [confirm, setConfirm] = useState<{ lorry: Lorry; driverId: string | null; lines: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const driverName = (id: string | null) => drivers.find((d) => d.id === id)?.full_name;
  const name = (id: string | null) => driverName(id) ?? L.aDriver;
  // The owning branch edits a lorry; a branch it's borrowed to only sees it and picks its driver.
  const owns = (l: Lorry) => canPlan(myBranch, l.branch);
  /** The borrowing branch's driver on it, who comes off when the lorry is taken back. */
  const borrowerDriver = (l: Lorry) => {
    const d = l.driver_id && l.branch ? drivers.find((x) => x.id === l.driver_id) : undefined;
    return d && !userBranches(d.branch).includes(l.branch!) ? d : undefined;
  };

  function run(fn: () => Promise<unknown>) {
    setError(null);
    start(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : t.couldntSave);
      }
    });
  }

  /** Picking a driver: remind who's on the lorry now (and where the new driver comes from) before changing. */
  function pickDriver(lorry: Lorry, driverId: string | null) {
    const lines: string[] = [];
    if (lorry.driver_id && lorry.driver_id !== driverId) {
      lines.push(L.assignedNow(lorry.lorry_no, name(lorry.driver_id)));
    }
    const from = driverId && allLorries.find((l) => l.driver_id === driverId && l.id !== lorry.id);
    if (from) lines.push(L.drivesNow(name(driverId), from.lorry_no));
    if (driverId && inMaintenance(lorry, today)) {
      lines.push(L.inMaintenance(lorry.lorry_no, lorry.maintenance_to ? date(lorry.maintenance_to) : null));
    }
    if (lines.length) setConfirm({ lorry, driverId, lines });
    else run(() => setLorryDriver(lorry.id, driverId));
  }

  const sorted = [...lorries].sort(byLorryNo);

  // Grid or list, remembered on this device.
  const [view, setView] = useState<View>("grid");
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "list") setView("list");
    } catch {}
  }, []);
  function changeView(v: View) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  }

  const [exporting, setExporting] = useState(false);
  /** Always in English, whatever language the screen is in. */
  async function exportExcel() {
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Lorries");
      ws.columns = [
        { header: "Lorry", key: "no", width: 8 },
        { header: "Plate", key: "plate", width: 12 },
        { header: "Branch", key: "branch", width: 14 },
        { header: "Driver", key: "driver", width: 22 },
        { header: `Status (${fmtDate(today)})`, key: "status", width: 34 },
        { header: "Maintenance from", key: "from", width: 16 },
        { header: "Back in service", key: "to", width: 16 },
        { header: "Maintenance note", key: "note", width: 28 },
        { header: "Borrow to", key: "borrow", width: 14 },
      ];
      ws.getRow(1).font = { bold: true };
      for (const l of sorted) {
        ws.addRow({
          no: l.lorry_no,
          plate: l.plate_no ?? "",
          branch: l.is_trailer ? "Trailer (all branches)" : l.branch ? branchName(l.branch) : "",
          driver: l.is_trailer ? "" : l.driver_id ? (driverName(l.driver_id) ?? EN.lorries.aDriver) : "Spare",
          status: lorryStatus(l, l.driver_id ? jobs[l.driver_id] : undefined, today, EN.lorries, EN.locale)[0],
          from: l.maintenance_from ? fmtDate(l.maintenance_from) : "",
          to: l.maintenance_to ? fmtDate(l.maintenance_to) : "",
          note: l.maintenance_note ?? "",
          borrow: l.borrow_branch ? branchName(l.borrow_branch) : "",
        });
      }
      const buf = await wb.xlsx.writeBuffer();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      a.download = `Lorries - ${branch ? branchName(branch) : "All branches"} - ${today}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setError(L.couldntExport);
    } finally {
      setExporting(false);
    }
  }

  /** The driver dropdown, the same in both views. */
  function driverSelect(l: Lorry) {
    if (l.is_trailer) return <p className="py-2 text-sm text-slate-500">{L.trailerNoDriver}</p>;
    const choices = drivers.filter((d) => !l.branch || !d.branch || d.branch === l.branch || d.branch === l.borrow_branch || d.id === l.driver_id);
    return (
      <select
        disabled={pending}
        aria-label={L.driverOf(l.lorry_no)}
        value={l.driver_id ?? ""} // always the saved driver: a cancelled change snaps back
        onChange={(e) => pickDriver(l, e.target.value || null)}
        className="input"
      >
        <option value="">{L.spareNoDriver}</option>
        {choices.map((d) => {
          const on = allLorries.find((x) => x.driver_id === d.id && x.id !== l.id);
          return (
            <option key={d.id} value={d.id}>
              {d.full_name}
              {on ? L.onLorry(on.lorry_no) : ""}
            </option>
          );
        })}
      </select>
    );
  }

  /** "Borrow to KS" on the owner's side, "Borrow from GP" on the borrower's. */
  function borrowTag(l: Lorry) {
    if (!l.borrow_branch) return null;
    return (
      <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
        {owns(l) ? L.borrowToB(l.borrow_branch) : L.borrowFromB(l.branch ?? "")}
      </span>
    );
  }

  /** Maintenance and Borrow to / Take back: the owning branch only. */
  function maintenanceButtons(l: Lorry) {
    if (!owns(l)) return null;
    const borrow = l.is_trailer ? null : l.borrow_branch ? (
      <button type="button" disabled={pending} onClick={() => setTakingBack(l)} className="btn-secondary py-1.5 text-xs">
        {L.takeBack}
      </button>
    ) : (
      <button type="button" disabled={pending || !l.branch} onClick={() => setBorrowing(l)} className="btn-secondary py-1.5 text-xs">
        {L.borrowTo}
      </button>
    );
    return l.maintenance_from ? (
      <>
        <button type="button" disabled={pending} onClick={() => run(() => endMaintenance(l.id))} className="btn-secondary py-1.5 text-xs">
          {L.backInService}
        </button>
        {borrow}
      </>
    ) : (
      <>
        <button type="button" onClick={() => setServicing(l)} className="btn-secondary py-1.5 text-xs">
          {L.maintenance}
        </button>
        {borrow}
      </>
    );
  }

  const viewButton = (v: View, label: string) => (
    <button
      type="button"
      onClick={() => changeView(v)}
      aria-pressed={view === v}
      className={`px-3 py-1.5 text-sm font-medium ${view === v ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:text-slate-900"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {error ? <p className="text-sm text-rose-700">{error}</p> : <span />}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-200" role="group" aria-label={L.view}>
            {viewButton("grid", L.grid)}
            {viewButton("list", L.list)}
          </div>
          <button type="button" disabled={exporting || !sorted.length} onClick={exportExcel} className="btn-secondary">
            {exporting ? L.exporting : L.excel}
          </button>
          <button type="button" onClick={() => setEditing("new")} className="btn-primary">
            {L.add}
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">{L.none(branch ? branchName(branch) : null)}</div>
      ) : view === "list" ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{L.lorry}</th>
                <th className="px-4 py-3">{L.plate}</th>
                <th className="px-4 py-3">{L.branch}</th>
                <th className="px-4 py-3">{L.statusCol}</th>
                <th className="px-4 py-3">{L.driver}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((l) => (
                <tr key={l.id} className={inMaintenance(l, today) ? "bg-amber-50/50" : ""}>
                  <td className="whitespace-nowrap px-4 py-2 font-semibold">{l.lorry_no}</td>
                  <td className="whitespace-nowrap px-4 py-2">{l.plate_no || <span className="text-slate-400">—</span>}</td>
                  <td className="whitespace-nowrap px-4 py-2">{l.is_trailer ? L.allBranches : l.branch ? branchName(l.branch) : <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <StatusBadge lorry={l} jobs={l.driver_id ? jobs[l.driver_id] : undefined} today={today} />
                      {borrowTag(l)}
                    </div>
                    {l.maintenance_from && l.maintenance_from > today && (
                      <p className="mt-1 text-xs text-amber-700">{L.maintenanceFrom(date(l.maintenance_from))}</p>
                    )}
                    {l.maintenance_note && inMaintenance(l, today) && <p className="mt-1 text-xs text-amber-800">🔧 {l.maintenance_note}</p>}
                  </td>
                  <td className="min-w-48 px-4 py-2">{driverSelect(l)}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-nowrap items-center justify-end gap-2">
                      {maintenanceButtons(l)}
                      {owns(l) && (!l.is_trailer || !lockedBranches) && (
                        <button type="button" onClick={() => setEditing(l)} className="text-sm font-medium text-slate-500 hover:text-slate-900">
                          {L.edit}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((l) => {
            const booked = l.maintenance_from && l.maintenance_from > today;
            return (
              <section key={l.id} className={`card flex flex-col gap-3 p-4 ${inMaintenance(l, today) ? "border-amber-300" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">{l.is_trailer ? L.trailer : L.lorry} {l.lorry_no}</h2>
                    <p className="text-sm text-slate-500">
                      {l.plate_no || L.noPlate}
                      {l.is_trailer ? ` · ${L.allBranches}` : l.branch && ` · ${branchName(l.branch)}`}
                    </p>
                  </div>
                  {owns(l) && (!l.is_trailer || !lockedBranches) && (
                    <button type="button" onClick={() => setEditing(l)} className="text-sm font-medium text-slate-500 hover:text-slate-900">
                      {L.edit}
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <StatusBadge lorry={l} jobs={l.driver_id ? jobs[l.driver_id] : undefined} today={today} />
                  {borrowTag(l)}
                  {booked && (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                      {L.maintenanceFrom(date(l.maintenance_from!))}
                    </span>
                  )}
                </div>

                <label className="block">
                  <span className="label">{L.driver}</span>
                  {driverSelect(l)}
                </label>

                {l.maintenance_note && inMaintenance(l, today) && <p className="text-sm text-amber-800">🔧 {l.maintenance_note}</p>}

                {owns(l) && <div className="flex flex-wrap gap-2">{maintenanceButtons(l)}</div>}

                {/* History notes are saved in English and shown as saved. */}
                {(events[l.id]?.length ?? 0) > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-slate-500 hover:text-slate-900">{L.history}</summary>
                    <ul className="mt-2 space-y-1.5">
                      {events[l.id].map((e) => (
                        <li key={e.id}>
                          {e.note}
                          <span className="block text-xs text-slate-400">
                            {fmtDateTime(e.created_at)}
                            {e.actor && ` · ${e.actor.full_name}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            );
          })}
        </div>
      )}

      {confirm && (
        <Modal title={L.changeDriver} subtitle={L.lorryNo(confirm.lorry.lorry_no)} onClose={() => setConfirm(null)}>
          <ul className="list-disc space-y-1 pl-5">
            {confirm.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="font-medium">
            {confirm.driverId ? L.putOn(name(confirm.driverId), confirm.lorry.lorry_no) : L.takeOff(name(confirm.lorry.driver_id), confirm.lorry.lorry_no)}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirm(null)} className="btn-secondary">
              {t.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                run(() => setLorryDriver(c.lorry.id, c.driverId));
              }}
              className="btn-primary"
            >
              {L.yesChange}
            </button>
          </div>
        </Modal>
      )}

      {borrowing && <BorrowForm lorry={borrowing} onClose={() => setBorrowing(null)} onSave={(to) => run(() => setLorryBorrow(borrowing.id, to))} />}

      {takingBack && (
        <Modal title={L.takeBackQ} subtitle={L.borrowedTo(takingBack.lorry_no, branchName(takingBack.borrow_branch))} onClose={() => setTakingBack(null)}>
          <p>
            {L.comesBack(
              takingBack.lorry_no,
              branchName(takingBack.branch),
              borrowerDriver(takingBack) ? `${borrowerDriver(takingBack)!.full_name} (${branchName(takingBack.borrow_branch)})` : null
            )}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setTakingBack(null)} className="btn-secondary">
              {t.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                const l = takingBack;
                setTakingBack(null);
                run(() => setLorryBorrow(l.id, null));
              }}
              className="btn-primary"
            >
              {L.yesTakeBack}
            </button>
          </div>
        </Modal>
      )}

      {servicing && (
        <MaintenanceForm lorry={servicing} driver={servicing.driver_id ? name(servicing.driver_id) : null} today={today} onClose={() => setServicing(null)} />
      )}
      {editing && <LorryForm lorry={editing === "new" ? null : editing} branch={branch} lockedBranches={lockedBranches} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Saves a form through a server action that returns { error }; closes on success. */
function useSave(action: (fd: FormData) => Promise<{ error?: string }>, onDone: () => void) {
  const t = useStaffT();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (fd: FormData) => {
    setError(null);
    start(async () => {
      try {
        const res = await action(fd);
        if (res.error) setError(res.error);
        else onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : t.couldntSave);
      }
    });
  };
  return { save, error, pending };
}

/** "Lorry 46 · JQN 9833" */
const lorryTitle = (L: LorryWords, l: Lorry) => `${L.lorryNo(l.lorry_no)}${l.plate_no ? ` · ${l.plate_no}` : ""}`;

function MaintenanceForm({ lorry, driver, today, onClose }: { lorry: Lorry; driver: string | null; today: string; onClose: () => void }) {
  const t = useStaffT();
  const L = t.lorries;
  const { save, error, pending } = useSave(setMaintenance, onClose);
  return (
    <Modal title={L.maintenanceTitle} subtitle={lorryTitle(L, lorry)} onClose={onClose}>
      <form action={save} className="space-y-4">
        <input type="hidden" name="id" value={lorry.id} />
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">{L.from}</span>
            <input type="date" name="maintenance_from" required defaultValue={lorry.maintenance_from ?? today} className="input" />
          </label>
          <label className="block">
            <span className="label">{L.backIfKnown}</span>
            <input type="date" name="maintenance_to" defaultValue={lorry.maintenance_to ?? ""} className="input" />
          </label>
        </div>
        <label className="block">
          <span className="label">{L.whatsDone}</span>
          <input name="maintenance_note" defaultValue={lorry.maintenance_note ?? ""} placeholder={L.whatsDonePh} className="input" />
        </label>
        {driver && <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-800">{L.stillOn(driver)}</p>}
        {error && <p className="text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            {t.cancel}
          </button>
          <button disabled={pending} className="btn-primary">
            {pending ? t.saving : t.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** "Borrow to": pick the branch the lorry is lent to. */
function BorrowForm({ lorry, onClose, onSave }: { lorry: Lorry; onClose: () => void; onSave: (to: string) => void }) {
  const t = useStaffT();
  const L = t.lorries;
  const [to, setTo] = useState("");
  return (
    <Modal title={L.borrowTo} subtitle={lorryTitle(L, lorry)} onClose={onClose}>
      <label className="block">
        <span className="label">{L.branch}</span>
        <select value={to} onChange={(e) => setTo(e.target.value)} className="input">
          <option value="" disabled>{L.chooseBranch}</option>
          {LORRY_BRANCHES.filter((b) => b.code !== lorry.branch).map((b) => (
            <option key={b.code} value={b.code}>{b.name}</option>
          ))}
        </select>
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary">
          {t.cancel}
        </button>
        <button
          type="button"
          disabled={!to}
          onClick={() => {
            onSave(to);
            onClose();
          }}
          className="btn-primary"
        >
          {L.borrowTo}
        </button>
      </div>
    </Modal>
  );
}

function LorryForm({ lorry, branch, lockedBranches, onClose }: { lorry: Lorry | null; branch: string | null; lockedBranches: string[] | null; onClose: () => void }) {
  const t = useStaffT();
  const L = t.lorries;
  const { save, error, pending } = useSave(saveLorry, onClose);
  const [trailer, setTrailer] = useState(!!lorry?.is_trailer);
  return (
    <Modal title={lorry ? L.editLorry(lorry.lorry_no) : L.addLorry} onClose={onClose}>
      <form action={save} className="space-y-4">
        {lorry && <input type="hidden" name="id" value={lorry.id} />}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">{L.lorryNumber}</span>
            <input name="lorry_no" required defaultValue={lorry?.lorry_no ?? ""} placeholder="46" className="input" />
          </label>
          <label className="block">
            <span className="label">{L.plateNumber}</span>
            <input name="plate_no" defaultValue={lorry?.plate_no ?? ""} placeholder="JQN 9833" className="input uppercase" />
          </label>
        </div>
        {/* A trailer is shared by every branch, so only staff not kept to their own branches set it. */}
        {!lockedBranches && (
          <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 p-3">
            <input type="checkbox" name="is_trailer" checked={trailer} onChange={(e) => setTrailer(e.target.checked)} className="mt-0.5 size-4" />
            <span>
              <span className="block font-medium">{L.trailer}</span>
              <span className="block text-xs text-slate-500">
                {L.trailerHelp}
                {lorry?.driver_id && trailer && L.trailerDriverOff}
              </span>
            </span>
          </label>
        )}
        {!trailer && (!lockedBranches || lockedBranches.length > 1) && (
          <label className="block">
            <span className="label">{L.branch}</span>
            <select name="branch" defaultValue={lorry?.branch ?? branch ?? ""} className="input">
              {!lockedBranches && <option value="">{L.noBranch}</option>}
              {LORRY_BRANCHES.filter((b) => !lockedBranches || lockedBranches.includes(b.code)).map((b) => (
                <option key={b.code} value={b.code}>{b.name}</option>
              ))}
            </select>
          </label>
        )}
        {error && <p className="text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            {t.cancel}
          </button>
          <button disabled={pending} className="btn-primary">
            {pending ? t.saving : t.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
