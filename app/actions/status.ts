"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSession, requireStaff } from "@/lib/auth";
import { sendDeliveredNotice, waApiEnabled } from "@/lib/whatsapp-api";
import type { DoStatus } from "@/lib/types";

// ---------- Delivery status (drivers + staff) ------------------------

async function logAndRevalidate(supabase: SupabaseClient, doId: string, status: DoStatus, note?: string | null) {
  const { data: d } = await supabase.from("delivery_orders").select("so_id").eq("id", doId).single();
  await supabase.from("status_events").insert({ so_id: d?.so_id, do_id: doId, status, note: note || null });
  revalidatePath("/driver");
  revalidatePath("/deliveries");
  revalidatePath("/orders/[id]", "page");
}

export async function startDelivery(doId: string) {
  const { supabase } = await getSession();
  const { error } = await supabase
    .from("delivery_orders")
    .update({ status: "out_for_delivery", failed_reason: null })
    .eq("id", doId);
  if (error) throw new Error(error.message);
  await logAndRevalidate(supabase, doId, "out_for_delivery");
}

export async function markDelivered(doId: string, photoPath: string | null, note: string) {
  const { supabase } = await getSession();
  const { error } = await supabase
    .from("delivery_orders")
    .update({ status: "delivered", pod_photo_path: photoPath, delivered_at: new Date().toISOString() })
    .eq("id", doId);
  if (error) throw new Error(error.message);
  await notifyDelivered(supabase, doId);
  await logAndRevalidate(supabase, doId, "delivered", note);
}

/** WhatsApps the customer "delivered" + the POD photo from the company number, and records how it went. Never throws. */
async function notifyDelivered(supabase: SupabaseClient, doId: string) {
  if (!waApiEnabled()) return;
  const { data: d } = await supabase
    .from("delivery_orders")
    .select("customer_name, so_no, do_no, contact_phone, pod_photo_path")
    .eq("id", doId)
    .single();
  if (!d) return;
  // Meta downloads the photo when it sends; a day leaves room for its retries.
  const photo = d.pod_photo_path ? (await supabase.storage.from("pod").createSignedUrl(d.pod_photo_path, 86400)).data?.signedUrl ?? null : null;
  const ref = d.so_no ? `${d.so_no} (${d.do_no})` : d.do_no;
  const r = await sendDeliveredNotice(d.contact_phone, { customer_name: d.customer_name, ref }, photo);
  await supabase
    .from("delivery_orders")
    .update(r.ok ? { wa_sent_at: new Date().toISOString(), wa_error: null } : { wa_error: r.error })
    .eq("id", doId);
}

/** Office: send the "delivered" WhatsApp again (e.g. after fixing the phone number). */
export async function resendDeliveredNotice(doId: string) {
  const { supabase } = await requireStaff();
  await notifyDelivered(supabase, doId);
  revalidatePath("/orders/[id]", "page");
}

export async function markFailed(doId: string, reason: string) {
  const { supabase } = await getSession();
  const { error } = await supabase
    .from("delivery_orders")
    .update({ status: "failed", failed_reason: reason })
    .eq("id", doId);
  if (error) throw new Error(error.message);
  await logAndRevalidate(supabase, doId, "failed", reason);
}
