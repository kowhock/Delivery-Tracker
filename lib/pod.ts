import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Signed links (valid 1 hour) to all of a DO's proof-of-delivery photos. They're stored as
 * "pod/<do id>/<time>.jpg"; pod_photo_path on the DO is the first one (sent on WhatsApp).
 */
export async function podPhotoUrls(supabase: SupabaseClient, doId: string, firstPath: string | null): Promise<string[]> {
  const { data: files } = await supabase.storage.from("pod").list(doId, { sortBy: { column: "name", order: "asc" } });
  const paths = (files ?? []).filter((f) => f.name.endsWith(".jpg")).map((f) => `${doId}/${f.name}`);
  if (!paths.length && firstPath) paths.push(firstPath);
  if (!paths.length) return [];
  const { data } = await supabase.storage.from("pod").createSignedUrls(paths, 3600);
  return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => !!u);
}
