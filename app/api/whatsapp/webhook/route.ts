// Meta WhatsApp webhook. GET answers Meta's one-time verification check;
// POST receives message statuses (sent/delivered/read/failed) and replies.
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  if (p.get("hub.mode") === "subscribe" &&
      p.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(p.get("hub.challenge"), { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  console.log("whatsapp webhook", JSON.stringify(body));
  return new Response("ok", { status: 200 });
}
