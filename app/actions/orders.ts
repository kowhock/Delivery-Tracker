"use server";

import { requireStaff } from "@/lib/auth";
import { deliveredOrSoldBy, lockedBranches } from "@/lib/branches";
import type { DoItem, SalesOrder, StatusEvent } from "@/lib/types";

// ---------- Sales order preview ---------------------------------------

export type SoPreview = { so: SalesOrder; items: DoItem[] };

/** An SO's header and items for the popup on Deliveries / Driver status (dispatchers can't open the SO page). */
export async function getSoPreview(soId: string): Promise<SoPreview | null> {
  const { supabase, profile } = await requireStaff();
  const [{ data: so }, { data: items }] = await Promise.all([
    supabase.from("sales_orders").select("*").eq("id", soId).single<SalesOrder>(),
    supabase.from("so_items").select("id, item_code, description, uom, qty").eq("so_id", soId).order("line_no"),
  ]);
  if (!so) return null;
  // Same rule as the SO page: dispatchers see their branches' SOs, or SOs on a DO their branches deliver or sold.
  const locked = lockedBranches(profile);
  if (locked && !locked.includes(so.branch ?? "")) {
    const { data: dos } = await supabase
      .from("delivery_orders")
      .select("id, do_sales_orders!inner(so_id)")
      .eq("do_sales_orders.so_id", soId)
      .or(deliveredOrSoldBy(locked))
      .limit(1);
    if (!dos?.length) return null;
  }
  return { so, items: (items ?? []) as DoItem[] };
}

/** A DO's item lines, for the DO popup on Deliveries. */
export async function getDoItems(doId: string): Promise<DoItem[]> {
  const { supabase } = await requireStaff();
  const { data, error } = await supabase.from("do_items").select("id, item_code, description, uom, qty").eq("do_id", doId);
  if (error) throw new Error(error.message);
  return (data ?? []) as DoItem[];
}

/** A signed link (valid 1 hour) to a DO's proof-of-delivery photo, for the DO popup. null = no photo. */
export async function getPodPhotoUrl(doId: string): Promise<string | null> {
  const { supabase } = await requireStaff();
  const { data: d } = await supabase.from("delivery_orders").select("pod_photo_path").eq("id", doId).single();
  if (!d?.pod_photo_path) return null;
  const { data } = await supabase.storage.from("pod").createSignedUrl(d.pod_photo_path, 3600);
  return data?.signedUrl ?? null;
}

/** Who changed a DO and when (newest first), for the DO popup. Admins only. */
export async function getDoHistory(doId: string): Promise<StatusEvent[]> {
  const { supabase, profile } = await requireStaff();
  if (profile.role !== "admin") throw new Error("Only admins can see a DO's history.");
  const { data, error } = await supabase
    .from("status_events")
    .select("id, status, note, created_at, do_id, actor:profiles!status_events_actor_id_fkey(full_name)")
    .eq("do_id", doId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as StatusEvent[];
}
