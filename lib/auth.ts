import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { Profile } from "./types";

/**
 * Logged-in user + their profile, or redirect to /login.
 * cache(): the layout and the page share one lookup per request (each new request still reads fresh).
 */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // select("*") so login keeps working even if a newer column (e.g. branch) hasn't been migrated yet.
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (error) console.error("Loading profile failed:", error.message);
  if (!data) redirect("/login?error=no-profile");
  const profile: Profile = { ...data, branch: data.branch ?? null };
  return { supabase, user, profile };
});

export async function requireStaff() {
  const s = await getSession();
  if (s.profile.role === "driver") redirect("/driver");
  return s;
}

/** Admin-only pages (Sales orders, Import). Dispatchers are sent back to Deliveries. */
export async function requireAdmin() {
  const s = await requireStaff();
  if (s.profile.role !== "admin") redirect("/deliveries");
  return s;
}
