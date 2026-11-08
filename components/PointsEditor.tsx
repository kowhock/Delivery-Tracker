"use client";

import { useState, useTransition } from "react";
import { calculateMissingPoints, setMapAddress, setPoints } from "@/app/actions";
import type { DeliveryOrder } from "@/lib/types";
import { EXTRA_STOP_POINTS } from "@/lib/commission";
import { useStaffT } from "./StaffLang";


type Job = Pick<DeliveryOrder, "id" | "address" | "map_address" | "points" | "points_manual" | "distance_km" | "geo_status" | "geo_address">;

/**
 * Points chip on a DO card; click to key points in, type an address Google can find
 * (when the delivery address can't be found), or go back to the distance rule.
 * `extraStop`: another DO in the same trip has the full points, so this one earns EXTRA_STOP_POINTS.
 */
/** `canEdit` false (no points access, lib/access.ts): the chip only shows the points. */
export function PointsEditor({ job, extraStop = false, canEdit = true, onEditing }: { job: Job; extraStop?: boolean; canEdit?: boolean; onEditing?: (editing: boolean) => void }) {
  const [editing, setEditingState] = useState(false);
  const [value, setValue] = useState(String(job.points ?? ""));
  const [address, setAddress] = useState(job.map_address ?? job.address ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const t = useStaffT();
  const P = t.points;

  const setEditing = (on: boolean) => {
    setEditingState(on);
    onEditing?.(on);
    setError(null);
    if (on) {
      setValue(String(job.points ?? ""));
      setAddress(job.map_address ?? job.address ?? "");
    }
  };
  const save = (points: number | null) =>
    start(async () => {
      try {
        await setPoints(job.id, points);
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : P.couldNotSave);
      }
    });

  /** Distance + points from a typed address (null = the delivery address again). */
  const find = (typed: string | null) =>
    start(async () => {
      try {
        setError(null);
        const r = await setMapAddress(job.id, typed);
        if (r.found) setEditing(false);
        else setError(P.stillNotFound(P.why[r.status ?? ""] ?? P.noDistance));
      } catch (e) {
        setError(e instanceof Error ? e.message : P.couldNotFind);
      }
    });

  if (editing) {
    return (
      <div className="space-y-1" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1">
          <input
            autoFocus
            type="number"
            min={0}
            max={99}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value !== "") save(Number(value));
              if (e.key === "Escape") setEditing(false);
            }}
            className="input w-16 px-2 py-1 text-xs"
            aria-label={P.aria}
          />
          <button disabled={pending || value === ""} onClick={() => save(Number(value))} className="btn-primary px-2 py-1 text-xs">
            {pending ? "…" : t.save}
          </button>
          <button onClick={() => setEditing(false)} className="px-1 text-slate-400 hover:text-slate-700" aria-label={t.cancel}>✕</button>
        </div>
        <div className="flex items-center gap-1">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && address.trim()) find(address);
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder={P.mapPh}
            className="input w-56 px-2 py-1 text-xs"
            aria-label={P.mapAria}
          />
          <button disabled={pending || !address.trim()} onClick={() => find(address)} className="btn-secondary px-2 py-1 text-xs">
            {P.find}
          </button>
        </div>
        {job.map_address && (
          <p className="text-[11px] text-slate-500">
            {P.autocount(job.address || t.noAddress)} ·{" "}
            <button disabled={pending} onClick={() => find(null)} className="text-brand-700 hover:underline">
              {P.useAgain}
            </button>
          </p>
        )}
        {job.points_manual && (
          <button disabled={pending} onClick={() => save(null)} className="text-[11px] text-brand-700 hover:underline">
            {P.useRule}
          </button>
        )}
        {error && <p className="text-[11px] text-rose-600">{error}</p>}
      </div>
    );
  }

  const missing = job.points == null;
  const detail = job.points_manual
    ? P.keyedIn
    : job.distance_km != null
      ? `${job.geo_status === "approx" ? "~" : ""}${Number(job.distance_km).toFixed(1)} km${job.map_address ? P.typedAddr : ""}`
      : missing
        ? P.why[job.geo_status ?? ""] ?? P.notCalculated
        : "";
  return (
    <button
      type="button"
      draggable={false}
      disabled={!canEdit}
      onClick={() => canEdit && setEditing(true)}
      title={!canEdit ? (job.map_address ? P.typedTitle(job.map_address) : "") + P.noAccess :
        (extraStop ? P.extraTitle(EXTRA_STOP_POINTS, job.points) : "") +
        (job.map_address ? P.typedTitle(job.map_address) : "") +
        (job.geo_address ? P.matchedTitle(job.geo_address) : P.clickTitle)
      }
      className={`inline-flex items-center gap-1 rounded-md px-1.5 disabled:cursor-default py-0.5 text-[11px] font-medium ${
        missing ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200 ring-inset" : "bg-yellow-50 text-yellow-800"
      }`}
    >
      ⭐ {missing ? (canEdit ? P.setPoints : P.noPoints) : extraStop ? P.pt(EXTRA_STOP_POINTS) : P.pts(job.points)}
      {extraStop ? (
        <span className="font-normal opacity-70">{P.extraStop(job.points)}</span>
      ) : (
        detail && <span className="font-normal opacity-70">· {detail}</span>
      )}
    </button>
  );
}

/** "Calculate N missing points" — runs the distance rule again for DOs without points. */
export function CalculatePointsButton({ ids }: { ids: string[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const t = useStaffT();
  if (!ids.length) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <button
        disabled={pending}
        className="btn-secondary py-1.5 text-sm"
        onClick={() =>
          start(async () => {
            try {
              const r = await calculateMissingPoints(ids);
              setMsg(t.points.worked(r.measured, r.needManual));
            } catch (e) {
              setMsg(e instanceof Error ? e.message : t.points.failed);
            }
          })
        }
      >
        {pending ? t.points.calculating : t.points.calculate(ids.length)}
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </span>
  );
}
