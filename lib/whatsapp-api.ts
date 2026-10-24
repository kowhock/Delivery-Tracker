import "server-only";
import { isMobile, normalizePhone } from "./format";

// WhatsApp Cloud API (Meta): sends from the company's own number, so customers get the
// "delivered" message + POD photo without the driver's phone. Setup steps are in the README.

const API = "https://graph.facebook.com/v23.0";
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const TEMPLATE_PHOTO = process.env.WHATSAPP_TEMPLATE_DELIVERED; // image header + {{1}} name, {{2}} order
const TEMPLATE_TEXT = process.env.WHATSAPP_TEMPLATE_DELIVERED_NO_PHOTO; // optional: same body, no header
const LANG = process.env.WHATSAPP_TEMPLATE_LANG || "en";

export const waApiEnabled = () => !!(TOKEN && PHONE_ID && TEMPLATE_PHOTO);

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

/** Sends the "delivered" template. `photoUrl` must be a link Meta can download (a signed URL is fine). */
export async function sendDeliveredNotice(
  rawPhone: string | null,
  vars: { customer_name: string; ref: string },
  photoUrl: string | null,
): Promise<SendResult> {
  const phone = normalizePhone(rawPhone);
  if (!isMobile(phone)) return { ok: false, error: "No mobile number" };
  const template = photoUrl ? TEMPLATE_PHOTO : TEMPLATE_TEXT;
  if (!template) return { ok: false, error: "No photo (no text-only template set up)" };

  const components: object[] = [
    { type: "body", parameters: [vars.customer_name, vars.ref].map((text) => ({ type: "text", text: text.slice(0, 200) })) },
  ];
  if (photoUrl) components.unshift({ type: "header", parameters: [{ type: "image", image: { link: photoUrl } }] });

  try {
    const res = await fetch(`${API}/${PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: { name: template, language: { code: LANG }, components },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, id: json.messages?.[0]?.id ?? "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}
