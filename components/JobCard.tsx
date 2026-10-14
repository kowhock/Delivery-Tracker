"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { markDelivered, markFailed, startDelivery } from "@/app/actions";
import { DoBadge } from "./StatusBadge";
import { fmtQty, mapsLinks } from "@/lib/format";
import { MESSAGES, whatsappLink } from "@/lib/whatsapp";
import { TIME_SLOTS, type DeliveryOrder } from "@/lib/types";

const FAIL_REASONS = ["Customer not available", "Shop closed", "Wrong / unclear address", "Customer rejected goods", "Vehicle problem", "Other"];

export function JobCard({ job, driverName }: { job: DeliveryOrder; driverName: string }) {
  const [mode, setMode] = useState<"idle" | "deliver" | "fail">("idle");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const msgData = { customer_name: job.customer_name, so_no: job.so_no, do_no: job.do_no, driverName };
  const waOnTheWay = whatsappLink(job.contact_phone, MESSAGES.out_for_delivery(msgData));
  const waDelivered = whatsappLink(job.contact_phone, MESSAGES.delivered(msgData));
  const maps = job.address ? mapsLinks(job.address) : null;
  const finished = job.status === "delivered";

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      try {
        await fn();
        setMode("idle");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });

  return (
    <article className={`card overflow-hidden ${finished ? "opacity-70" : ""}`}>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-slate-500">
              {job.do_no}{job.so_no && ` · ${job.so_no}`}
              <span className="ml-1.5 rounded bg-yellow-50 px-1.5 font-medium text-yellow-800">
                ⭐ {job.points == null ? "pts pending" : `${job.points} pts`}
              </span>
            </p>
            <h2 className="text-lg font-semibold leading-tight">{job.customer_name}</h2>
          </div>
          <DoBadge status={job.status} />
        </div>

        {job.address && <p className="text-sm text-slate-600">{job.address}</p>}
        {job.time_slot && <p className="text-sm font-medium text-sky-700">🕒 Estimated {TIME_SLOTS[job.time_slot]}</p>}
        {job.instructions && <p className="rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-900">📋 {job.instructions}</p>}
        {job.remarks && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">📝 {job.remarks}</p>}

        {!finished && (
          <div className="grid grid-cols-3 gap-2">
            {maps && <a href={maps.waze} className="btn-secondary px-2">Waze</a>}
            {maps && <a href={maps.google} className="btn-secondary px-2">Maps</a>}
            {job.contact_phone && <a href={`tel:${job.contact_phone}`} className="btn-secondary px-2">Call</a>}
          </div>
        )}

        {(job.do_items?.length ?? 0) > 0 && <details className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">{job.do_items?.length ?? 0} items</summary>
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
          <p className="text-sm text-rose-600">Failed: {job.failed_reason}</p>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>

      {/* Actions */}
      <div className="border-t border-slate-100 bg-slate-50/60 p-3">
        {job.status === "assigned" && (
          <button disabled={pending} onClick={() => run(() => startDelivery(job.id))} className="btn-primary w-full py-3">
            {pending ? "…" : "Start delivery"}
          </button>
        )}

        {job.status === "out_for_delivery" && mode === "idle" && (
          <div className="space-y-2">
            {waOnTheWay && (
              <a href={waOnTheWay} target="_blank" className="btn-whatsapp w-full">Tell customer I&apos;m on the way</a>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMode("fail")} className="btn-secondary py-3 text-rose-600">Can&apos;t deliver</button>
              <button onClick={() => setMode("deliver")} className="btn-primary py-3">Delivered</button>
            </div>
          </div>
        )}

        {mode === "deliver" && <DeliverForm pending={pending} onCancel={() => setMode("idle")} onSubmit={(file, note) =>
          run(async () => {
            const path = file ? await uploadPhoto(job.id, file) : null;
            await markDelivered(job.id, path, note);
          })} />}

        {mode === "fail" && <FailForm pending={pending} onCancel={() => setMode("idle")} onSubmit={(reason) => run(() => markFailed(job.id, reason))} />}

        {finished && (
          waDelivered
            ? <a href={waDelivered} target="_blank" className="btn-whatsapp w-full">Send &ldquo;delivered&rdquo; WhatsApp</a>
            : <p className="text-center text-sm text-emerald-700">✓ Delivered</p>
        )}

        {job.status === "failed" && (
          <p className="text-center text-xs text-slate-500">The office will reschedule this delivery.</p>
        )}
      </div>
    </article>
  );
}

function DeliverForm({ pending, onCancel, onSubmit }: { pending: boolean; onCancel: () => void; onSubmit: (f: File | null, note: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white p-4 text-sm font-medium text-slate-600">
        📷 {file ? file.name : "Take photo of signed DO / goods"}
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Received by / note (optional)" className="input" />
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
        <button disabled={pending} onClick={() => onSubmit(file, note)} className="btn-primary">{pending ? "Saving…" : "Confirm"}</button>
      </div>
    </div>
  );
}

function FailForm({ pending, onCancel, onSubmit }: { pending: boolean; onCancel: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState(FAIL_REASONS[0]);
  const [other, setOther] = useState("");
  return (
    <div className="space-y-3">
      <select value={reason} onChange={(e) => setReason(e.target.value)} className="input">
        {FAIL_REASONS.map((r) => <option key={r}>{r}</option>)}
      </select>
      {reason === "Other" && <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="What happened?" className="input" />}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
        <button disabled={pending} onClick={() => onSubmit(reason === "Other" ? other || "Other" : reason)} className="btn bg-rose-600 text-white hover:bg-rose-700">
          {pending ? "Saving…" : "Mark failed"}
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
