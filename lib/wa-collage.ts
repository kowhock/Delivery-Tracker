import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COLLAGE_MAX, collageLayout, deliveryPhotos } from "./collage-layout";

/** WhatsApp's limit for an image is 5 MB; stay under it. */
const MAX_BYTES = 4.5 * 1024 * 1024;

/**
 * The picture sent with the "delivered" WhatsApp: the DO's only photo, or (2–6 photos) one collage of
 * this delivery's photos. The collage is saved under "whatsapp/" in the pod bucket, so the office's
 * photo list (lib/pod.ts, which only lists "<do id>/") never shows it. Returns a signed link Meta can
 * download, or null. Any problem with the collage falls back to the first photo, as before.
 */
export async function whatsappPhotoUrl(supabase: SupabaseClient, doId: string, firstPath: string): Promise<string | null> {
  const sign = async (path: string) => (await supabase.storage.from("pod").createSignedUrl(path, 86400)).data?.signedUrl ?? null;
  try {
    const { data: files } = await supabase.storage.from("pod").list(doId);
    const names = deliveryPhotos((files ?? []).map((f) => f.name), firstPath).slice(0, COLLAGE_MAX);
    if (names.length < 2) return await sign(firstPath);

    const photos = await Promise.all(
      names.map(async (name) => {
        const { data, error } = await supabase.storage.from("pod").download(`${doId}/${name}`);
        if (error || !data) throw new Error(error?.message ?? "download failed");
        return Buffer.from(await data.arrayBuffer());
      })
    );
    const layout = collageLayout(photos.length);
    const tiles = await Promise.all(
      photos.map(async (buf, i) => {
        const c = layout.cells[i];
        // Whole photo inside its box (no cropping), turned the right way up, white around it.
        const input = await sharp(buf).rotate().resize(c.width, c.height, { fit: "contain", background: "#ffffff" }).toBuffer();
        return { input, left: c.left, top: c.top };
      })
    );
    const canvas = sharp({ create: { width: layout.width, height: layout.height, channels: 3, background: "#ffffff" } }).composite(tiles);
    let jpg = await canvas.clone().jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    if (jpg.length > MAX_BYTES) jpg = await canvas.clone().jpeg({ quality: 70, mozjpeg: true }).toBuffer();
    if (jpg.length > MAX_BYTES) return await sign(firstPath);

    const path = `whatsapp/${doId}-${Date.now()}.jpg`;
    const { error } = await supabase.storage.from("pod").upload(path, jpg, { contentType: "image/jpeg" });
    if (error) return await sign(firstPath);
    return await sign(path);
  } catch (e) {
    console.error("WhatsApp collage failed, sending the first photo:", e instanceof Error ? e.message : e);
    return sign(firstPath);
  }
}
