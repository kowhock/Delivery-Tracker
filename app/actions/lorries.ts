"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { branchName, canPlan, lockedBranch } from "@/lib/branches";

// ---------- Lorries ---------------------------------------------------

const notYourLorry = (branch: string) => `This lorry belongs to ${branchName(branch)} — only ${branchName(branch)} can change it.`;

async function lorryForEdit(supabase: SupabaseClient, profile: { branch: string | null }, id: string) {
  const { data: l } = await supabase.from("lorries").select("id, lorry_no, branch, driver_id").eq("id", id).single();
  if (!l) throw new Error("Lorry not found.");
  if (!canPlan(profile.branch, l.branch)) throw new Error(notYourLorry(l.branch));
  return l as { id: string; lorry_no: string; branch: string | null; driver_id: string | null };
}

function revalidateLorries() {
  revalidatePath("/lorries");
  revalidatePath("/drivers");
  revalidatePath("/deliveries");
  revalidatePath("/trip-form");
}

/** Adds a lorry, or (with an id) changes its number / plate / branch. */
export async function saveLorry(formData: FormData): Promise<{ error?: string }> {
  const { supabase, profile } = await requireStaff();
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const id = get("id");
  const lorryNo = get("lorry_no");
  if (!lorryNo) return { error: "Key in the lorry number." };
  const row = {
    lorry_no: lorryNo,
    plate_no: get("plate_no").toUpperCase() || null,
    branch: lockedBranch(profile) ?? (get("branch") || null), // dispatchers only keep their own branch's lorries
  };
  if (id) await lorryForEdit(supabase, profile, id);
  const { data, error } = id
    ? await supabase.from("lorries").update(row).eq("id", id).select("id").single()
    : await supabase.from("lorries").insert(row).select("id").single();
  if (error) return { error: error.code === "23505" ? `Lorry ${lorryNo} already exists.` : error.message };
  await supabase.from("lorry_events").insert({ lorry_id: data.id, note: id ? "Details changed" : "Lorry added" });
  revalidateLorries();
  return {};
}

/** Puts a driver on a lorry (or takes them off with null). A driver drives one lorry, so they leave their old one. */
export async function setLorryDriver(lorryId: string, driverId: string | null) {
  const { supabase, profile } = await requireStaff();
  const lorry = await lorryForEdit(supabase, profile, lorryId);
  if (lorry.driver_id === driverId) return;

  const names = new Map<string, string>();
  const ids = [lorry.driver_id, driverId].filter((x): x is string => !!x);
  if (ids.length) {
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of data ?? []) names.set(p.id, p.full_name);
  }

  if (driverId) {
    const { data: old } = await supabase.from("lorries").select("id").eq("driver_id", driverId).neq("id", lorryId).maybeSingle();
    if (old) {
      const { error } = await supabase.from("lorries").update({ driver_id: null }).eq("id", old.id);
      if (error) throw new Error(error.message);
      await supabase.from("lorry_events").insert({ lorry_id: old.id, note: `${names.get(driverId)} moved to lorry ${lorry.lorry_no}` });
    }
  }
  const { error } = await supabase.from("lorries").update({ driver_id: driverId }).eq("id", lorryId);
  if (error) throw new Error(error.message);
  const note = driverId
    ? lorry.driver_id
      ? `Driver changed: ${names.get(lorry.driver_id)} → ${names.get(driverId)}`
      : `Driver: ${names.get(driverId)}`
    : `${names.get(lorry.driver_id!)} taken off`;
  await supabase.from("lorry_events").insert({ lorry_id: lorryId, note });
  revalidateLorries();
}

/** Books a lorry for maintenance from a day (to a day, if known). */
export async function setMaintenance(formData: FormData): Promise<{ error?: string }> {
  const { supabase, profile } = await requireStaff();
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const from = get("maintenance_from");
  const to = get("maintenance_to") || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return { error: "Pick the day maintenance starts." };
  if (to && to < from) return { error: "The back-in-service day is before the start day." };
  const lorry = await lorryForEdit(supabase, profile, get("id"));
  const note = get("maintenance_note") || null;
  const { error } = await supabase
    .from("lorries")
    .update({ maintenance_from: from, maintenance_to: to, maintenance_note: note })
    .eq("id", lorry.id);
  if (error) return { error: error.message };
  await supabase.from("lorry_events").insert({
    lorry_id: lorry.id,
    note: `Maintenance ${fmtDate(from)}${to ? ` – ${fmtDate(to)}` : " (no return date yet)"}${note ? `: ${note}` : ""}`,
  });
  revalidateLorries();
  return {};
}

export async function endMaintenance(lorryId: string) {
  const { supabase, profile } = await requireStaff();
  const lorry = await lorryForEdit(supabase, profile, lorryId);
  const { error } = await supabase
    .from("lorries")
    .update({ maintenance_from: null, maintenance_to: null, maintenance_note: null })
    .eq("id", lorry.id);
  if (error) throw new Error(error.message);
  await supabase.from("lorry_events").insert({ lorry_id: lorry.id, note: "Back in service" });
  revalidateLorries();
}
