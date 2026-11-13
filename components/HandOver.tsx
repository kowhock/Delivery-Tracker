"use client";

import { useState, useTransition } from "react";
import { setHelperBranch, setTrailer } from "@/app/actions";
import { BRANCHES, branchName } from "@/lib/branches";
import { useStaffT } from "@/components/StaffLang";
import { OUTSOURCE_COMPANIES, OUTSOURCE_TRAILER } from "@/lib/trailer";

/**
 * `trailer`: the trailer delivering the DO now (null = none; id OUTSOURCE_TRAILER = an outsource trailer, label = its company).
 * `trailers`: every trailer, for any branch to pick.
 */
export type HandOverInfo = { branch: string; helper: string | null; hasDriver: boolean; trailer: { id: string; label: string } | null; trailers: { id: string; label: string }[] };

const TRAILER = "trailer";

/**
 * "Assign other branch" in the DO popup: that branch then sees the DO and its drivers are the
 * ones offered for it. Or "Trailer": a trailer (no driver) delivers it, so it's delivered right away.
 * Shown to the DO's own branch only; it needs no driver on the DO.
 */
export function HandOver({ doId, branch, helper, hasDriver, trailer, trailers }: { doId: string } & HandOverInfo) {
  const [choosing, setChoosing] = useState(false);
  const outsourced = trailer?.id === OUTSOURCE_TRAILER;
  const [to, setTo] = useState(outsourced ? OUTSOURCE_TRAILER : trailer ? TRAILER : (helper ?? ""));
  const [trailerId, setTrailerId] = useState(outsourced ? "" : (trailer?.id ?? ""));
  const [company, setCompany] = useState(outsourced ? trailer!.label : "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = useStaffT();
  const H = t.handOver;

  function run(fn: () => Promise<unknown>) {
    setError(null);
    start(async () => {
      try {
        await fn();
        setChoosing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : t.couldntSave);
      }
    });
  }

  if (!choosing) {
    return (
      <div className="min-w-0">
        <button type="button" onClick={() => setChoosing(true)} className="btn-secondary">
          {outsourced ? H.onOutsource(trailer!.label) : trailer ? H.onTrailer(trailer.label) : helper ? H.delivering(branchName(helper)) : H.assignOther}
        </button>
        {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
      </div>
    );
  }

  const unchanged =
    to === TRAILER ? !trailerId || trailerId === trailer?.id : to === OUTSOURCE_TRAILER ? !company || (outsourced && company === trailer!.label) : !to || (to === helper && !trailer);
  return (
    <div className="min-w-0 space-y-1.5">
      {hasDriver ? (
        <p className="text-xs text-amber-700">{H.takeDriverOff}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select value={to} onChange={(e) => setTo(e.target.value)} aria-label={H.aria} className="input w-auto py-1.5">
              <option value="" disabled>{H.choose}</option>
              {BRANCHES.filter((b) => b.store && b.code !== branch).map((b) => (
                <option key={b.code} value={b.code}>{b.name}</option>
              ))}
              <option value={TRAILER}>{H.trailer}</option>
              <option value={OUTSOURCE_TRAILER}>{H.outsource}</option>
            </select>
            {to === TRAILER && trailers.length > 0 && (
              <select value={trailerId} onChange={(e) => setTrailerId(e.target.value)} aria-label={H.trailerAria} className="input w-auto py-1.5">
                <option value="" disabled>{H.chooseTrailer}</option>
                {trailers.map((x) => (
                  <option key={x.id} value={x.id}>{x.label}</option>
                ))}
              </select>
            )}
            {to === OUTSOURCE_TRAILER && (
              <select value={company} onChange={(e) => setCompany(e.target.value)} aria-label={H.companyAria} className="input w-auto py-1.5">
                <option value="" disabled>{H.chooseCompany}</option>
                {OUTSOURCE_COMPANIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              disabled={pending || unchanged || (to === TRAILER && !trailers.length)}
              onClick={() =>
                run(async () => {
                  if (to === TRAILER) return setTrailer(doId, trailerId);
                  if (to === OUTSOURCE_TRAILER) return setTrailer(doId, OUTSOURCE_TRAILER, company);
                  // From a trailer to a branch: take it off the trailer first (back to Unassigned), then hand over.
                  if (trailer) await setTrailer(doId, null);
                  await setHelperBranch(doId, to);
                })
              }
              className="btn-primary"
            >
              {pending ? t.saving : H.assign}
            </button>
            {trailer ? (
              <button type="button" disabled={pending} onClick={() => run(() => setTrailer(doId, null))} className="text-sm font-medium text-rose-600 hover:underline">
                {H.trailerUndo}
              </button>
            ) : (
              helper && (
                <button type="button" disabled={pending} onClick={() => run(() => setHelperBranch(doId, null))} className="text-sm font-medium text-rose-600 hover:underline">
                  {H.takeBack}
                </button>
              )
            )}
          </div>
          {to === TRAILER && <p className="text-xs text-slate-500">{trailers.length ? H.trailerNote : H.noTrailers}</p>}
          {to === OUTSOURCE_TRAILER && <p className="text-xs text-slate-500">{H.trailerNote}</p>}
        </>
      )}
      <button type="button" onClick={() => setChoosing(false)} className="text-xs text-slate-500 hover:text-slate-900">
        {t.cancel}
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
