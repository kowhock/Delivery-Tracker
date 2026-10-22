/**
 * AutoCount → Supabase sync of delivery orders. Only READS from AutoCount (deliveryorder/select).
 * Runs on a computer in the office network (the AutoCount API is at a 192.168.x.x address).
 *
 *   npm run autocount:sync -- --days 14   one time: DOs dated in the last 14 days (backfill)
 *   npm run autocount:sync                keeps running: every 5 minutes, DOs changed since the last run
 *
 * Signs in to Supabase as the staff user in SUPABASE_SYNC_EMAIL / SUPABASE_SYNC_PASSWORD.
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAcDeliveryOrders, type AcSelectFilter } from "../lib/autocount-api";
import { importAcDeliveryOrders } from "../lib/autocount";
import { mapsEnabled, updateDistances } from "../lib/geo";

const EVERY_MIN = 5;
const OVERLAP_MIN = 5; // re-read a few minutes before the last run, so nothing slips between runs
const FIRST_RUN_HOURS = 1; // when the loop starts, catch up on the last day

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is missing in .env.local`);
  return v;
};

// AutoCount wants "2026/10/22", in Malaysia time.
const dayMY = (msAgo = 0) =>
  new Date(Date.now() - msAgo).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).replace(/-/g, "/");

// "2026/10/22 16:00:00" in Malaysia time, whatever timezone this computer is set to.
const timeMY = (d: Date) =>
  new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 19).replace("T", " ").replace(/-/g, "/");

const log = (s: string) =>
  console.log(`[${new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur" })}] ${s}`);

const supabase = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
  auth: { persistSession: false, autoRefreshToken: true },
});

async function syncOnce(filter: AcSelectFilter) {
  const t0 = Date.now();

  log("Reading DOs from AutoCount…");
  const dos = await fetchAcDeliveryOrders(filter);
  const d = await importAcDeliveryOrders(supabase, dos);
  log(`DO: ${dos.length} read, ${d.created.length} new, ${d.updated.length} updated`);

  for (const m of d.errors) log(`ERROR ${m}`);
  for (const m of d.warnings) log(`warning ${m}`);

  // New / changed delivery addresses → driving distance → driver points (same as the Import page).
  const doNos = [...d.created, ...d.updated];
  if (doNos.length && mapsEnabled()) {
    const ids: string[] = [];
    for (let i = 0; i < doNos.length; i += 200) {
      const { data } = await supabase.from("delivery_orders").select("id").in("do_no", doNos.slice(i, i + 200));
      ids.push(...(data ?? []).map((r) => r.id as string));
    }
    const r = await updateDistances(supabase, ids);
    log(`Distances worked out for ${r.measured} DOs`);
  }

  log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

async function main() {
  log("Signing in to Supabase…");
  const { error } = await supabase.auth.signInWithPassword({
    email: need("SUPABASE_SYNC_EMAIL"),
    password: need("SUPABASE_SYNC_PASSWORD"),
  });
  if (error) throw new Error(`Supabase sign-in: ${error.message}`);

  const i = process.argv.indexOf("--days");
  if (i > 0) {
    const days = Number(process.argv[i + 1]);
    const filter = { DateFrom: dayMY(days * 864e5), DateTo: dayMY() };
    log(`One-time sync: documents dated ${filter.DateFrom} – ${filter.DateTo} (this can take a while)`);
    await syncOnce(filter);
    return;
  }

  log(`Syncing every ${EVERY_MIN} minutes. Ctrl+C stops it.`);
  let lastSuccess: Date | null = null;

  for (;;) {
    const startedAt = new Date();
    const from = lastSuccess
      ? new Date(lastSuccess.getTime() - OVERLAP_MIN * 60e3)
      : new Date(startedAt.getTime() - FIRST_RUN_HOURS * 3600e3);
    const filter = { LastModifiedFrom: timeMY(from), LastModifiedTo: timeMY(startedAt) };

    log(`Changes from ${filter.LastModifiedFrom} to ${filter.LastModifiedTo}`);
    try {
      await syncOnce(filter);
      lastSuccess = startedAt; // only move forward when the whole run worked
    } catch (e) {
      log(`ERROR ${e instanceof Error ? e.message : e} — next run will cover this gap`);
    }

    // wait until 5 minutes after this run started (not 5 minutes after it finished)
    const wait = Math.max(10e3, EVERY_MIN * 60e3 - (Date.now() - startedAt.getTime()));
    await new Promise((r) => setTimeout(r, wait));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});