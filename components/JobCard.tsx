"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { markDelivered, markFailed, startDelivery } from "@/app/actions";
import { DoBadge } from "./StatusBadge";
import { fmtQty, mapAddress, mapsLinks } from "@/lib/format";
import { MESSAGES, whatsappLink } from "@/lib/whatsapp";
import { TIME_SLOTS, type DeliveryOrder } from "@/lib/types";
import { DICT, type Lang } from "@/lib/i18n";

type Dict = (typeof DICT)[Lang];

// Saved in English (the office reads them); the driver sees them in their language.
const FAIL_REASONS = ["Customer not available", "Shop closed", "Wrong / unclear address", "Customer rejected goods", "Vehicle problem", "Other"];

export function JobCard({ job, driverName, lang = "en" }: { job: DeliveryOrder; driverName: string; lang?: Lang }) {
  const t = DICT[lang];
  const [mode, setMode] = useState<"idle" | "deliver" | "fail">("idle");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const msgData = { customer_name: job.customer_name, so_no: job.so_no, do_no: job.do_no, driverName };
  const waOnTheWay = whatsappLink(job.contact_phone, MESSAGES.out_for_delivery(msgData));
  const waDelivered = whatsappLink(job.contact_phone, MESSAGES.delivered(msgData));
  // The office's typed address goes to the exact spot Google found for it.
  const address = mapAddress(job);
  const spot = job.map_address && job.geo_lat != null && job.geo_lng != null && job.geo_input === address ? { lat: job.geo_lat, lng: job.geo_lng } : null;
  const maps = address ? mapsLinks(address, spot) : null;
  const finished = job.status === "delivered";

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      try {
        await fn();
        setMode("idle");
      } catch (e) {
        setError(e instanceof Error ? e.message : t.somethingWrong);
      }
    });

  return (
    <article className={`card overflow-hidden ${finished ? "opacity-70" : ""}`}>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-slate-500">
              {job.do_no}
              <span className="ml-1.5 rounded bg-kh-yellow/25 px-1.5 font-medium text-slate-900">
                ⭐ {job.points == null ? t.ptsPending : t.pts(job.points)}
              </span>
            </p>
            <h2 className="text-lg font-semibold leading-tight text-slate-900">{job.customer_name}</h2>
          </div>
          <DoBadge status={job.status} label={t.status[job.status]} />
        </div>

        {address && <p className="text-sm text-slate-700">{address}</p>}
        {job.map_address && job.address && <p className="text-xs text-slate-400">AutoCount: {job.address}</p>}
        {job.time_slot && <p className="text-sm font-medium text-sky-700">🕒 {t.estimated(TIME_SLOTS[job.time_slot])}</p>}
        {job.instructions && <p className="rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-900">📋 {job.instructions}</p>}
        {job.remarks && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">📝 {job.remarks}</p>}

        {!finished && (
          <div className="grid grid-cols-3 gap-2">
            {maps && <a href={maps.waze} className="btn-neutral px-2">Waze</a>}
            {maps && <a href={maps.google} className="btn-neutral px-2">Maps</a>}
            {job.contact_phone && <a href={`tel:${job.contact_phone}`} className="btn-neutral px-2">{t.call}</a>}
          </div>
        )}

        {(job.do_items?.length ?? 0) > 0 && <details className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">{t.items(job.do_items?.length ?? 0)}</summary>
          <ul className="mt-2 space-y-1">
            {job.do_items?.map((i) => (
              <li key={i.id} className="flex justify-between gap-3">
                <span className="text-slate-600">{i.description || i.item_code}</span>
                <span className="font-medium tabular-nums">{fmtQty(i.qty)} {i.uom}</span>
              </li>
            ))}
          </ul>
        </details>}

        {job.failed_reason && job.status === "failed" && (
          <p className="text-sm text-rose-600">{t.failed(t.failReasons[job.failed_reason] ?? job.failed_reason)}</p>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>

      {/* Actions */}
      <div className="border-t border-slate-100 p-3">
        {job.status === "assigned" && (
          <button disabled={pending} onClick={() => run(() => startDelivery(job.id))} className="btn-kh w-full py-3.5 text-base">
            {pending ? "…" : t.startDelivery}
          </button>
        )}

        {job.status === "out_for_delivery" && mode === "idle" && (
          <div className="space-y-2">
            {waOnTheWay && (
              <a href={waOnTheWay} target="_blank" className="btn-whatsapp w-full">{t.onTheWay}</a>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMode("fail")} className="btn-neutral py-3 text-rose-600">{t.cantDeliver}</button>
              <button onClick={() => setMode("deliver")} className="btn-kh py-3">{t.delivered}</button>
            </div>
          </div>
        )}

        {mode === "deliver" && <DeliverForm t={t} pending={pending} onCancel={() => setMode("idle")} onSubmit={(file, note) =>
          run(async () => {
            const path = file ? await uploadPhoto(job.id, file) : null;
            await markDelivered(job.id, path, note);
          })} />}

        {mode === "fail" && <FailForm t={t} pending={pending} onCancel={() => setMode("idle")} onSubmit={(reason) => run(() => markFailed(job.id, reason))} />}

        {finished && (
          waDelivered
            ? <a href={waDelivered} target="_blank" className="btn-whatsapp w-full">{t.sendDelivered}</a>
            : <p className="text-center text-sm text-emerald-700">{t.deliveredDone}</p>
        )}

        {job.status === "failed" && (
          <p className="text-center text-xs text-slate-500">{t.willReschedule}</p>
        )}
      </div>
    </article>
  );
}

function DeliverForm({ t, pending, onCancel, onSubmit }: { t: Dict; pending: boolean; onCancel: () => void; onSubmit: (f: File | null, note: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white p-4 text-sm font-medium text-slate-600">
        📷 {file ? file.name : t.takePhoto}
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.receivedBy} className="input" />
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onCancel} className="btn-neutral">{t.cancel}</button>
        <button disabled={pending} onClick={() => onSubmit(file, note)} className="btn-kh">{pending ? t.saving : t.confirm}</button>
      </div>
    </div>
  );
}

function FailForm({ t, pending, onCancel, onSubmit }: { t: Dict; pending: boolean; onCancel: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState(FAIL_REASONS[0]);
  const [other, setOther] = useState("");
  return (
    <div className="space-y-3">
      <select value={reason} onChange={(e) => setReason(e.target.value)} className="input">
        {FAIL_REASONS.map((r) => <option key={r} value={r}>{t.failReasons[r] ?? r}</option>)}
      </select>
      {reason === "Other" && <input value={other} onChange={(e) => setOther(e.target.value)} placeholder={t.whatHappened} className="input" />}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onCancel} className="btn-neutral">{t.cancel}</button>
        <button disabled={pending} onClick={() => onSubmit(reason === "Other" ? other || "Other" : reason)} className="btn bg-rose-600 text-white hover:bg-rose-700">
          {pending ? t.saving : t.markFailed}
        </button>
      </div>
    </div>
  );
}

/** Shrinks the photo (saves drivers' mobile data) and uploads it to the "pod" bucket. */
async function uploadPhoto(doId: string, file: File): Promise<string> {
  const blob = await shrinkImage(file);
  const path = `${doId}/${Date.now()}.jpg`;
  const { error } = await createClient().storage.from("pod").upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw new Error("Photo upload failed: " + error.message);
  return path;
}

async function shrinkImage(file: File, max = 1280): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej()), "image/jpeg", 0.75));
  } catch {
    return file; // fall back to the original if the browser can't resize it
  }
}
