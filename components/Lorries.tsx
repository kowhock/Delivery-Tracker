"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { endMaintenance, saveLorry, setLorryDriver, setMaintenance } from "@/app/actions";
import { BRANCHES, branchName } from "@/lib/branches";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { inMaintenance, type Lorry } from "@/lib/types";

type Driver = { id: string; full_name: string; branch: string | null };
/** A driver's jobs today: DOs out for delivery now, assigned ones still to go, delivered ones. */
export type LorryJobs = { onRoad: string[]; left: number; delivered: number };
export type LorryEvent = { id: number; note: string; created_at: string; actor: { full_name: string } | null };

/** Popup shell: native <dialog>, portalled to <body>; clicking the backdrop closes it. */
function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
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
        <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="text-xl leading-none text-slate-400 hover:text-slate-900">
          ×
        </button>
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </dialog>,
    document.body
  );
}

/** What a lorry is doing today, as text and badge colours. */
function lorryStatus(lorry: Lorry, jobs: LorryJobs | undefined, today: string): [string, string] {
  return inMaintenance(lorry, today)
    ? [`Under maintenance${lorry.maintenance_to ? ` until ${fmtDate(lorry.maintenance_to)}` : ""}`, "bg-amber-100 text-amber-800"]
    : !lorry.driver_id
      ? ["Spare", "bg-slate-100 text-slate-600"]
      : jobs?.onRoad.length
        ? [`On the road · ${jobs.onRoad.join(", ")}`, "bg-blue-100 text-blue-800"]
        : jobs?.left
          ? [`${jobs.left} job${jobs.left > 1 ? "s" : ""} left today`, "bg-indigo-50 text-indigo-700"]
          : jobs?.delivered
            ? [`Done today · ${jobs.delivered} delivered`, "bg-emerald-100 text-emerald-800"]
            : ["Available", "bg-emerald-50 text-emerald-700"];
}

function StatusBadge({ lorry, jobs, today }: { lorry: Lorry; jobs?: LorryJobs; today: string }) {
  const [text, look] = lorryStatus(lorry, jobs, today);
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
}: {
  lorries: Lorry[];
  allLorries: Lorry[]; // every branch's, to tell which lorry a driver is on now
  drivers: Driver[];
  jobs: Record<string, LorryJobs>;
  events: Record<string, LorryEvent[]>;
  today: string;
  branch: string | null;
  lockedBranches: string[] | null; // dispatchers: the branches they can put a lorry under
}) {
  const [editing, setEditing] = useState<Lorry | "new" | null>(null);
  const [servicing, setServicing] = useState<Lorry | null>(null);
  const [confirm, setConfirm] = useState<{ lorry: Lorry; driverId: string | null; lines: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const name = (id: string | null) => drivers.find((d) => d.id === id)?.full_name ?? "a driver";

  function run(fn: () => Promise<unknown>) {
    setError(null);
    start(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save — try again.");
      }
    });
  }

  /** Picking a driver: remind who's on the lorry now (and where the new driver comes from) before changing. */
  function pickDriver(lorry: Lorry, driverId: string | null) {
    const lines: string[] = [];
    if (lorry.driver_id && lorry.driver_id !== driverId) {
      lines.push(`Lorry ${lorry.lorry_no} is assigned to ${name(lorry.driver_id)} now.`);
    }
    const from = driverId && allLorries.find((l) => l.driver_id === driverId && l.id !== lorry.id);
    if (from) lines.push(`${name(driverId)} drives lorry ${from.lorry_no} now and will be taken off it.`);
    if (driverId && inMaintenance(lorry, today)) {
      lines.push(`Lorry ${lorry.lorry_no} is under maintenance${lorry.maintenance_to ? ` until ${fmtDate(lorry.maintenance_to)}` : ""}.`);
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
      ];
      ws.getRow(1).font = { bold: true };
      for (const l of sorted) {
        ws.addRow({
          no: l.lorry_no,
          plate: l.plate_no ?? "",
          branch: l.branch ? branchName(l.branch) : "",
          driver: l.driver_id ? name(l.driver_id) : "Spare",
          status: lorryStatus(l, l.driver_id ? jobs[l.driver_id] : undefined, today)[0],
          from: l.maintenance_from ? fmtDate(l.maintenance_from) : "",
          to: l.maintenance_to ? fmtDate(l.maintenance_to) : "",
          note: l.maintenance_note ?? "",
        });
      }
      const buf = await wb.xlsx.writeBuffer();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      a.download = `Lorries - ${branch ? branchName(branch) : "All branches"} - ${today}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setError("Couldn't export — try again.");
    } finally {
      setExporting(false);
    }
  }

  /** The driver dropdown, the same in both views. */
  function driverSelect(l: Lorry) {
    const choices = drivers.filter((d) => !l.branch || !d.branch || d.branch === l.branch || d.id === l.driver_id);
    return (
      <select
        disabled={pending}
        aria-label={`Driver of lorry ${l.lorry_no}`}
        value={l.driver_id ?? ""} // always the saved driver: a cancelled change snaps back
        onChange={(e) => pickDriver(l, e.target.value || null)}
        className="input"
      >
        <option value="">Spare (no driver)</option>
        {choices.map((d) => {
          const on = allLorries.find((x) => x.driver_id === d.id && x.id !== l.id);
          return (
            <option key={d.id} value={d.id}>
              {d.full_name}
              {on ? ` (on lorry ${on.lorry_no})` : ""}
            </option>
          );
        })}
      </select>
    );
  }

  function maintenanceButtons(l: Lorry) {
    return l.maintenance_from ? (
      <>
        <button type="button" disabled={pending} onClick={() => run(() => endMaintenance(l.id))} className="btn-secondary py-1.5 text-xs">
          ✅ Back in service
        </button>
        <button type="button" onClick={() => setServicing(l)} className="btn-secondary py-1.5 text-xs">
          Change dates
        </button>
      </>
    ) : (
      <button type="button" onClick={() => setServicing(l)} className="btn-secondary py-1.5 text-xs">
        🔧 Maintenance
      </button>
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
          <div className="flex overflow-hidden rounded-lg border border-slate-200" role="group" aria-label="View">
            {viewButton("grid", "▦ Grid")}
            {viewButton("list", "☰ List")}
          </div>
          <button type="button" disabled={exporting || !sorted.length} onClick={exportExcel} className="btn-secondary">
            {exporting ? "Exporting…" : "Excel"}
          </button>
          <button type="button" onClick={() => setEditing("new")} className="btn-primary">
            + Add lorry
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">
          No lorries {branch ? `in ${branchName(branch)} branch` : "yet"}. Add one to link it to a driver.
        </div>
      ) : view === "list" ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Lorry</th>
                <th className="px-4 py-3">Plate</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((l) => (
                <tr key={l.id} className={inMaintenance(l, today) ? "bg-amber-50/50" : ""}>
                  <td className="whitespace-nowrap px-4 py-2 font-semibold">{l.lorry_no}</td>
                  <td className="whitespace-nowrap px-4 py-2">{l.plate_no || <span className="text-slate-400">—</span>}</td>
                  <td className="whitespace-nowrap px-4 py-2">{l.branch ? branchName(l.branch) : <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-2">
                    <StatusBadge lorry={l} jobs={l.driver_id ? jobs[l.driver_id] : undefined} today={today} />
                    {l.maintenance_from && l.maintenance_from > today && (
                      <p className="mt-1 text-xs text-amber-700">Maintenance from {fmtDate(l.maintenance_from)}</p>
                    )}
                    {l.maintenance_note && inMaintenance(l, today) && <p className="mt-1 text-xs text-amber-800">🔧 {l.maintenance_note}</p>}
                  </td>
                  <td className="min-w-48 px-4 py-2">{driverSelect(l)}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-nowrap items-center justify-end gap-2">
                      {maintenanceButtons(l)}
                      <button type="button" onClick={() => setEditing(l)} className="text-sm font-medium text-slate-500 hover:text-slate-900">
                        Edit
                      </button>
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
                    <h2 className="text-lg font-semibold tracking-tight">Lorry {l.lorry_no}</h2>
                    <p className="text-sm text-slate-500">
                      {l.plate_no || "No plate number"}
                      {l.branch && ` · ${branchName(l.branch)}`}
                    </p>
                  </div>
                  <button type="button" onClick={() => setEditing(l)} className="text-sm font-medium text-slate-500 hover:text-slate-900">
                    Edit
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <StatusBadge lorry={l} jobs={l.driver_id ? jobs[l.driver_id] : undefined} today={today} />
                  {booked && (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                      Maintenance from {fmtDate(l.maintenance_from)}
                    </span>
                  )}
                </div>

                <label className="block">
                  <span className="label">Driver</span>
                  {driverSelect(l)}
                </label>

                {l.maintenance_note && inMaintenance(l, today) && <p className="text-sm text-amber-800">🔧 {l.maintenance_note}</p>}

                <div className="flex flex-wrap gap-2">{maintenanceButtons(l)}</div>

                {(events[l.id]?.length ?? 0) > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-slate-500 hover:text-slate-900">History</summary>
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
        <Modal title="Change driver?" subtitle={`Lorry ${confirm.lorry.lorry_no}`} onClose={() => setConfirm(null)}>
          <ul className="list-disc space-y-1 pl-5">
            {confirm.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="font-medium">
            {confirm.driverId ? `Put ${name(confirm.driverId)} on lorry ${confirm.lorry.lorry_no}?` : `Take ${name(confirm.lorry.driver_id)} off lorry ${confirm.lorry.lorry_no}?`}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirm(null)} className="btn-secondary">
              Cancel
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
              Yes, change
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
        setError(e instanceof Error ? e.message : "Couldn't save — try again.");
      }
    });
  };
  return { save, error, pending };
}

function MaintenanceForm({ lorry, driver, today, onClose }: { lorry: Lorry; driver: string | null; today: string; onClose: () => void }) {
  const { save, error, pending } = useSave(setMaintenance, onClose);
  return (
    <Modal title="Maintenance" subtitle={`Lorry ${lorry.lorry_no}${lorry.plate_no ? ` · ${lorry.plate_no}` : ""}`} onClose={onClose}>
      <form action={save} className="space-y-4">
        <input type="hidden" name="id" value={lorry.id} />
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">From</span>
            <input type="date" name="maintenance_from" required defaultValue={lorry.maintenance_from ?? today} className="input" />
          </label>
          <label className="block">
            <span className="label">Back in service (if known)</span>
            <input type="date" name="maintenance_to" defaultValue={lorry.maintenance_to ?? ""} className="input" />
          </label>
        </div>
        <label className="block">
          <span className="label">What's being done</span>
          <input name="maintenance_note" defaultValue={lorry.maintenance_note ?? ""} placeholder="e.g. Service + tyres" className="input" />
        </label>
        {driver && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-800">
            {driver} is still on this lorry. To keep {driver} delivering, put them on another lorry from its card.
          </p>
        )}
        {error && <p className="text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button disabled={pending} className="btn-primary">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LorryForm({ lorry, branch, lockedBranches, onClose }: { lorry: Lorry | null; branch: string | null; lockedBranches: string[] | null; onClose: () => void }) {
  const { save, error, pending } = useSave(saveLorry, onClose);
  return (
    <Modal title={lorry ? `Edit lorry ${lorry.lorry_no}` : "Add lorry"} onClose={onClose}>
      <form action={save} className="space-y-4">
        {lorry && <input type="hidden" name="id" value={lorry.id} />}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Lorry number</span>
            <input name="lorry_no" required defaultValue={lorry?.lorry_no ?? ""} placeholder="46" className="input" />
          </label>
          <label className="block">
            <span className="label">Plate number</span>
            <input name="plate_no" defaultValue={lorry?.plate_no ?? ""} placeholder="JQN 9833" className="input uppercase" />
          </label>
        </div>
        {(!lockedBranches || lockedBranches.length > 1) && (
          <label className="block">
            <span className="label">Branch</span>
            <select name="branch" defaultValue={lorry?.branch ?? branch ?? ""} className="input">
              {!lockedBranches && <option value="">No branch</option>}
              {BRANCHES.filter((b) => b.store && (!lockedBranches || lockedBranches.includes(b.code))).map((b) => (
                <option key={b.code} value={b.code}>{b.name}</option>
              ))}
            </select>
          </label>
        )}
        {error && <p className="text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button disabled={pending} className="btn-primary">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
