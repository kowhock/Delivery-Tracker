"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { TODO_LABEL, type OutstandingTodo } from "@/lib/types";

// ---------- Outstanding DO work ---------------------------------------

/** Flags a DO that still needs a CN / DO edit / DR etc. in AutoCount. */
export async function addOutstanding(formData: FormData): Promise<{ error?: string }> {
  const { supabase } = await requireStaff();
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const todo = get("todo") as OutstandingTodo;
  if (!(todo in TODO_LABEL)) return { error: "Choose a to-do." };
  if (!get("reason")) return { error: "Key in a reason." };
  if (todo === "other" && !get("todo_other")) return { error: "Say what the other to-do is." };
  const { error } = await supabase.from("do_outstanding").insert({
    do_id: get("do_id"),
    reason: get("reason"),
    todo,
    todo_other: todo === "other" ? get("todo_other") : null,
    description: get("description") || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/deliveries");
  revalidatePath("/outstanding");
  return {};
}

export async function clearOutstanding(id: string) {
  const { supabase, user } = await requireStaff();
  const { error } = await supabase
    .from("do_outstanding")
    .update({ cleared_at: new Date().toISOString(), cleared_by: user.id })
    .eq("id", id)
    .is("cleared_at", null);
  if (error) throw new Error(error.message);
  revalidatePath("/deliveries");
  revalidatePath("/outstanding");
}
