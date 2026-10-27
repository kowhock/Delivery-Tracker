"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// ---------- Auth ------------------------------------------------------

/** Username accounts are Supabase users with the email "<username>@khdelivery.my" (never emailed). */
const USERNAME_DOMAIN = "khdelivery.my";

export async function signIn(_prev: { error?: string } | undefined, formData: FormData) {
  const supabase = await createClient();
  const login = String(formData.get("login")).trim().toLowerCase();
  const { error } = await supabase.auth.signInWithPassword({
    email: login.includes("@") ? login : `${login}@${USERNAME_DOMAIN}`,
    password: String(formData.get("password")),
  });
  if (error) return { error: "Wrong username or password." };
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
