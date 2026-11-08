"use client";

import { useEffect, useState, useTransition } from "react";
import { moveToTrip, optimiseTrip } from "@/app/actions";
import { DoBadge } from "./StatusBadge";
import { BranchTags } from "./DocLinks";
import { DoOutstanding } from "./Outstanding";
import { PointsEditor } from "./PointsEditor";
import { mapAddress } from "@/lib/format";
import { withTripPoints } from "@/lib/commission";
import { doMatches } from "@/lib/search";
import { dayDmy } from "@/lib/date-range";
import { SearchIcon } from "./Icons";
import { TIME_SLOTS, type DeliveryOrder, type DoStatus } from "@/lib/types";
import { itemNoteLines } from "@/lib/item-note";
import { useStaffT } from "./StaffLang";

type Driver = { id: string; full_name: string; real_name?: string | null; branch: string | null; lorry_no: string | null };
/** Delivered DOs in the shown dates (by delivery time), with points and commission. */
export type DriverStats = { delivered: number; points: number; missingPoints: number; rm: number };
type Lane = { driverId: string; date: string; tripNo: number };
type RouteResult = Awaited<ReturnType<typeof optimiseTrip>>;

/** Orders already on the road or delivered stay where they are. */
const LOCKED: DoStatus[] = ["out_for_delivery", "delivered"];

const laneKey = (l: Lane) => `${l.driverId}|${l.date}|${l.tripNo}`;
const inLane = (j: DeliveryOrder, l: Lane) => j.driver_id === l.driverId && j.delivery_date === l.date && j.trip_no === l.tripNo;
const bySeq = (a: DeliveryOrder, b: DeliveryOrder) => a.trip_seq - b.trip_seq;

export function DriverTrips({
  drivers,
  dates,
  jobs: initial,
  stats,
  canEditPoints = false,
}: {
  drivers: Driver[];
  dates: string[];
  jobs: DeliveryOrder[];
  stats: Record<string, DriverStats>;
  /** May change points (lib/access.ts). */
  canEditPoints?: boolean;
}) {
  const [jobs, setJobs] = useState(initial);
  const t = useStaffT();
  const T = t.drivers;
  useEffect(() => setJobs(initial), [initial]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null); // lane key or order id under the cursor
  const [error, setError] = useState<string | null>(null);
  const [editingPoints, setEditingPoints] = useState<string | null>(null); // no dragging while typing points
  const [pending, start] = useTransition();
  const [routes, setRoutes] = useState<Record<string, RouteResult>>({}); // best route per trip, until the trip changes
  const [routing, setRouting] = useState<string | null>(null);
  // Search box: only matching DOs (and the drivers / days that have them) show. Drag and drop still works.
  const [search, setSearch] = useState("");
  const searching = search.trim() !== "";
  const matches = (j: DeliveryOrder) => doMatches(j, search);

  function planRoute(lane: Lane) {
    const key = laneKey(lane);
    setRouting(key);
    setError(null);
    start(async () => {
      try {
        const r = await optimiseTrip(lane);
        setRoutes((all) => ({ ...all, [key]: r }));
      } catch (e) {
        setError(e instanceof Error ? e.message : T.couldNotPlan);
      } finally {
        setRouting(null);
      }
    });
  }

  function drop(lane: Lane, beforeId: string | null) {
    const id = dragId;
    setDragId(null);
    setOver(null);
    const moved = jobs.find((j) => j.id === id);
    if (!moved || beforeId === id) return;

    const target = jobs.filter((j) => j.id !== moved.id && inLane(j, lane)).sort(bySeq);
    const at = beforeId ? target.findIndex((j) => j.id === beforeId) : -1;
    target.splice(at < 0 ? target.length : at, 0, {
      ...moved,
      driver_id: lane.driverId,
      delivery_date: lane.date,
      trip_no: lane.tripNo,
    });

    const before = jobs;
    setRoutes((all) => {
      const next = { ...all };
      delete next[laneKey(lane)];
      delete next[laneKey({ driverId: moved.driver_id ?? "", date: moved.delivery_date, tripNo: moved.trip_no })];
      return next;
    });
    setJobs(jobs.filter((j) => j.id !== moved.id && !inLane(j, lane)).concat(target.map((j, i) => ({ ...j, trip_seq: i }))));
    setError(null);
    start(async () => {
      try {
        await moveToTrip({ doId: moved.id, ...lane, orderedIds: target.map((j) => j.id) });
      } catch (e) {
        setJobs(before);
        setError(e instanceof Error ? e.message : T.couldNotMove);
      }
    });
  }

  /** `shownNo`: the number on screen — trips are counted 1, 2, 3… over the ones that have DOs (see below). */
  function renderLane(lane: Lane, laneJobs: DeliveryOrder[], isNew: boolean, shownNo: number) {
    const key = laneKey(lane);
    const delivered = laneJobs.filter((j) => j.status === "delivered").length;
    const notLeft = laneJobs.filter((j) => !LOCKED.includes(j.status)).length;
    const extraStops = new Set(withTripPoints(laneJobs).filter((j) => j.extraStop).map((j) => j.id));
    const route = routes[key];
    return (
      <div
        key={key}
        onDragOver={(e) => {
          if (!dragId) return;
          e.preventDefault();
          setOver(key);
        }}
        onDrop={(e) => {
          e.preventDefault();
          drop(lane, null);
        }}
        className={`flex w-64 shrink-0 flex-col rounded-xl p-2 transition ${
          isNew ? "border-2 border-dashed border-slate-200" : "bg-slate-100/70"
        } ${over === key ? "ring-2 ring-brand-600" : ""}`}
      >
        <div className="flex items-center justify-between px-1 pb-2 text-xs font-semibold text-slate-600">
          <span>{isNew ? T.newTrip(shownNo) : T.trip(shownNo)}</span>
          {!isNew && <span className="font-normal text-slate-400">{T.laneDone(delivered, laneJobs.length)}</span>}
        </div>
        {!isNew && notLeft >= 2 && (
          <div className="px-1 pb-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => planRoute(lane)}
              title={T.bestRouteTitle}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-300 disabled:opacity-50"
            >
              {routing === key ? T.planning : T.bestRoute}
            </button>
            {route && (
              <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
                {T.route(route.store, notLeft - route.notFound.length)}<b className="text-slate-700">{route.km} km</b>
                {T.about(route.minutes >= 60 ? T.hours(Math.floor(route.minutes / 60), route.minutes % 60) : T.minutes(route.minutes))}
                {route.mapsUrl && (
                  <>
                    {" · "}
                    <a href={route.mapsUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{T.openMaps}</a>
                  </>
                )}
                {route.notFound.length > 0 && (
                  <span className="block text-rose-600">{T.notFoundLast(route.notFound.join(", "))}</span>
                )}
              </p>
            )}
          </div>
        )}
        <div className="flex min-h-12 flex-1 flex-col gap-2">
          {laneJobs.map((j, i) => {
            if (searching && !matches(j)) return null;
            const locked = LOCKED.includes(j.status);
            return (
              <article
                key={j.id}
                draggable={!locked && editingPoints !== j.id}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", j.id);
                  setDragId(j.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOver(null);
                }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setOver(j.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  drop(lane, j.id);
                }}
                className={`card space-y-1 p-2.5 text-xs ${
                  locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"
                } ${j.status === "delivered" ? "opacity-60" : ""} ${dragId === j.id ? "opacity-40" : ""} ${
                  over === j.id && dragId !== j.id ? "border-t-4 border-t-brand-600" : ""
                }`}
              >
                {/* DO number on its own line; the status (with its time) underneath, so long badges don't squeeze it. */}
                <div className="space-y-1">
                  <span className="block whitespace-nowrap font-semibold text-slate-900">
                    <span className="mr-1 text-slate-400">{i + 1}.</span>
                    <DoOutstanding doId={j.id} doNo={j.do_no} customer={j.customer_name} createdAt={j.created_at} docDate={j.doc_date} open={[]} photo={!!j.pod_photo_path} />
                  </span>
                  <DoBadge
                    status={j.status}
                    label={t.status[j.status]}
                    at={j.status === "delivered" ? j.delivered_at : j.status === "out_for_delivery" ? j.started_at : null}
                  />
                </div>
                <p className="text-sm font-medium leading-snug">{j.customer_name}</p>
                {mapAddress(j) && <p className="line-clamp-2 text-slate-500" title={j.map_address ? `AutoCount: ${j.address ?? t.noAddress}` : undefined}>{j.map_address && "📍 "}{mapAddress(j)}</p>}
                {j.time_slot && <p className="text-sky-700">🕒 {t.estimated(TIME_SLOTS[j.time_slot])}</p>}
                {j.remarks && <p className="line-clamp-2 rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">{j.remarks}</p>}
                <div className="flex items-center justify-between gap-2 text-slate-400">
                  <span className="whitespace-nowrap">{T.items(j.do_items?.length || itemNoteLines(j.item_note).length)}</span>
                </div>
                {j.instructions && <p className="line-clamp-2 rounded bg-violet-50 px-1.5 py-0.5 text-violet-800">📋 {j.instructions}</p>}
                {/* M- DOs: the items the office typed (AutoCount sends none for invoices). */}
                {j.item_note && <p className="line-clamp-3 whitespace-pre-line rounded bg-slate-50 px-1.5 py-0.5 text-slate-700">📦 {j.item_note}</p>}
                <div className="flex flex-wrap items-center gap-1.5">
                  <PointsEditor job={j} extraStop={extraStops.has(j.id)} canEdit={canEditPoints} onEditing={(on) => setEditingPoints(on ? j.id : null)} />
                  <BranchTags job={j} />
                </div>
                {j.status === "failed" && j.failed_reason && <p className="text-rose-600">{j.failed_reason}</p>}
              </article>
            );
          })}
          {laneJobs.length === 0 && (
            <p className="py-3 text-center text-xs text-slate-400">{isNew ? T.dropNew : T.dropHere}</p>
          )}
        </div>
      </div>
    );
  }

  const found = searching ? jobs.filter(matches).length : 0;
  return (
    <div className="space-y-4">
      {/* Search on the right; what it found (and Clear) just before it. */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {searching && (
          <span className="text-sm text-slate-500">
            {found ? T.found(found) : T.noMatch}
            <button type="button" onClick={() => setSearch("")} className="ml-3 text-brand-700 hover:underline">{t.clear}</button>
          </span>
        )}
        <label className="relative w-full sm:w-80">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={T.search}
            aria-label={T.search}
            className="input py-2 pl-9 pr-3 text-sm"
          />
        </label>
      </div>
      {error && <p className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>}
      {pending && <p className="text-xs text-slate-400">{t.saving}</p>}

      {drivers.map((d) => {
        const mine = jobs.filter((j) => j.driver_id === d.id);
        if (searching && !mine.some(matches)) return null; // no match for this driver
        const done = mine.filter((j) => j.status === "delivered").length;
        return (
          <section key={d.id} className="card overflow-hidden">
            <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
              <span className="grid size-8 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
                {d.full_name.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <h2 className="flex items-center gap-2 font-semibold leading-tight">
                  {d.full_name}
                  {d.lorry_no && (
                    <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">{t.lorry(d.lorry_no)}</span>
                  )}
                </h2>
                {(d.branch || d.real_name) && <p className="text-xs text-slate-500">{[d.branch, d.real_name].filter(Boolean).join(" · ")}</p>}
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-3 text-sm text-slate-500">
                {stats[d.id] && (
                  <span className="rounded-lg bg-yellow-50 px-2 py-0.5 text-yellow-900" title={T.statsTitle}>
                    ⭐ {stats[d.id].points} pts · 💰 RM {stats[d.id].rm}
                    {stats[d.id].missingPoints > 0 && <span className="text-rose-600">{T.needPoints(stats[d.id].missingPoints)}</span>}
                  </span>
                )}
                <span>{t.doneOf(done, mine.length)}</span>
                <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${mine.length ? (done / mine.length) * 100 : 0}%` }} />
                </div>
              </div>
            </header>
            <div className="divide-y divide-slate-100">
              {dates.map((date) => {
                const day = mine.filter((j) => j.delivery_date === date);
                if (searching && !day.some(matches)) return null; // no match on this day
                // Only trips that have DOs, numbered 1, 2, 3… on screen: if Trips 1–2 were emptied, Trip 3 shows
                // as Trip 1. The saved trip_no stays as it is (failed attempts and extra-stop points go by it);
                // lanes still use it, so drag and drop goes to the right trip. A day with no DOs shows Trip 1.
                const used = [...new Set(day.map((j) => j.trip_no))].sort((a, b) => a - b);
                const trips = used.length ? used : [1];
                const next = trips[trips.length - 1] + 1;
                return (
                  <div key={date} className="flex flex-col gap-2 px-4 py-3 md:flex-row">
                    <p className="w-28 shrink-0 text-sm font-medium tabular-nums text-slate-600">{dayDmy(date)}</p>
                    <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
                      {trips.map((t, i) => {
                        const lane = { driverId: d.id, date, tripNo: t };
                        const laneJobs = day.filter((j) => j.trip_no === t).sort(bySeq);
                        if (searching && !laneJobs.some(matches)) return null; // numbers still count every trip
                        return renderLane(lane, laneJobs, false, i + 1);
                      })}
                      {day.length > 0 && !searching && renderLane({ driverId: d.id, date, tripNo: next }, [], true, trips.length + 1)}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
