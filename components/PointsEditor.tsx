"use client";

import { useState, useTransition } from "react";
import { calculateMissingPoints, setMapAddress, setPoints } from "@/app/actions";
import type { DeliveryOrder } from "@/lib/types";
import { EXTRA_STOP_POINTS } from "@/lib/commission";

const WHY_MISSING: Record<string, string> = {
  not_found: "address not found on map",
  no_store: "no store address for this branch",
  no_address: "no delivery address",
  error: "map lookup failed",
};

type Job = Pick<DeliveryOrder, "id" | "address" | "map_address" | "points" | "points_manual" | "distance_km" | "geo_status" | "geo_address">;

/**
 * Points chip on a DO card; click to key points in, type an address Google can find
 * (when the delivery address can't be found), or go back to the distance rule.
 * `extraStop`: another DO in the same trip has the full points, so this one earns EXTRA_STOP_POINTS.
 */
export function PointsEditor({ job, extraStop = false, onEditing }: { job: Job; extraStop?: boolean; onEditing?: (editing: boolean) => void }) {
  const [editing, setEditingState] = useState(false);
  const [value, setValue] = useState(String(job.points ?? ""));
  const [address, setAddress] = useState(job.map_address ?? job.address ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
        setError(e instanceof Error ? e.message : "Could not save");
      }
    });

  /** Distance + points from a typed address (null = the delivery address again). */
  const find = (typed: string | null) =>
    start(async () => {
      try {
        setError(null);
        const r = await setMapAddress(job.id, typed);
        if (r.found) setEditing(false);
        else setError(`Still not found (${WHY_MISSING[r.status ?? ""] ?? "no distance"}) — add the taman / town, or key in points.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not find it");
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
            aria-label="Points"
          />
          <button disabled={pending || value === ""} onClick={() => save(Number(value))} className="btn-primary px-2 py-1 text-xs">
            {pending ? "…" : "Save"}
          </button>
          <button onClick={() => setEditing(false)} className="px-1 text-slate-400 hover:text-slate-700" aria-label="Cancel">✕</button>
        </div>
        <div className="flex items-center gap-1">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && address.trim()) find(address);
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="Address to find on the map"
            className="input w-56 px-2 py-1 text-xs"
            aria-label="Address for the map"
          />
          <button disabled={pending || !address.trim()} onClick={() => find(address)} className="btn-secondary px-2 py-1 text-xs">
            📍 Find
          </button>
        </div>
        {job.map_address && (
          <p className="text-[11px] text-slate-500">
            AutoCount: {job.address || "no address"} ·{" "}
            <button disabled={pending} onClick={() => find(null)} className="text-brand-700 hover:underline">
              use it again
            </button>
          </p>
        )}
        {job.points_manual && (
          <button disabled={pending} onClick={() => save(null)} className="text-[11px] text-brand-700 hover:underline">
            Use distance rule instead
          </button>
        )}
        {error && <p className="text-[11px] text-rose-600">{error}</p>}
      </div>
    );
  }

  const missing = job.points == null;
  const detail = job.points_manual
    ? "keyed in"
    : job.distance_km != null
      ? `${job.geo_status === "approx" ? "~" : ""}${Number(job.distance_km).toFixed(1)} km${job.map_address ? " · typed address" : ""}`
      : missing
        ? WHY_MISSING[job.geo_status ?? ""] ?? "not calculated"
        : "";
  return (
    <button
      type="button"
      draggable={false}
      onClick={() => setEditing(true)}
      title={
        (extraStop ? `Extra stop in this trip: ${EXTRA_STOP_POINTS} pt (${job.points} pts if it were the only DO)\n` : "") +
        (job.map_address ? `Typed address: ${job.map_address}\n` : "") +
        (job.geo_address ? `Matched: ${job.geo_address}\nClick to change points or address` : "Click to set points or type an address")
      }
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
        missing ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200 ring-inset" : "bg-yellow-50 text-yellow-800"
      }`}
    >
      ⭐ {missing ? "Set points" : extraStop ? `${EXTRA_STOP_POINTS} pt` : `${job.points} pts`}
      {extraStop ? (
        <span className="font-normal opacity-70">· extra stop ({job.points} alone)</span>
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
              setMsg(`${r.measured} worked out` + (r.needManual ? `, ${r.needManual} still need keying in` : ""));
            } catch (e) {
              setMsg(e instanceof Error ? e.message : "Failed");
            }
          })
        }
      >
        {pending ? "Calculating…" : `📍 Calculate ${ids.length} missing points`}
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </span>
  );
}
