/**
 * AutoCount → Supabase sync of delivery orders. Only READS from AutoCount (deliveryorder/select, invoice/select).
 * Inter-company invoices (M-PT-…) are delivered like DOs, so they're synced as DOs too.
 * Runs on a computer in the office network (the AutoCount API is at a 192.168.x.x address).
 *
 *   npm run autocount:sync -- --days 14   one time: DOs dated in the last 14 days, day by day (backfill)
 *   npm run autocount:sync                keeps running: every 5 minutes, DOs changed since the last run
 *
 * Signs in to Supabase as the staff user in SUPABASE_SYNC_EMAIL / SUPABASE_SYNC_PASSWORD.
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAcDeliveryOrders, fetchAcIcbDeliveryOrders, type AcSelectFilter } from "../lib/autocount-api";
import { importAcDeliveryOrders } from "../lib/autocount";
import type { AcDeliveryOrder } from "../lib/autocount-rows";
import { mapsEnabled, updateDistances } from "../lib/geo";

const EVERY_MIN = 5;
const OVERLAP_MIN = 5; // re-read a few minutes before the last run, so nothing slips between runs
const FIRST_RUN_HOURS = 24; // when the loop starts and there's no earlier sync on record, catch up on the last day
const MAX_CATCH_UP_DAYS = 7; // after a long gap (PC off for a week), don't re-read more than this

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

// Save → log → work out distances. Called once per document kind, so DOs are saved before the slow invoice read.
async function save(what: string, rows: AcDeliveryOrder[]) {
  const d = await importAcDeliveryOrders(supabase, rows);
  log(`${what}: ${rows.length} read, ${d.created.length} new, ${d.updated.length} updated`);

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
}

async function syncOnce(filter: AcSelectFilter) {
  const t0 = Date.now();

  log("Reading DOs from AutoCount…");
  await save("DO", await fetchAcDeliveryOrders(filter));
  log("Reading inter-company invoices (M-…) from AutoCount…");
  await save("Inter-company invoice", await fetchAcIcbDeliveryOrders(filter));

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
    log(`One-time sync: documents dated ${dayMY(days * 864e5)} – ${dayMY()}, one day at a time (this can take a while)`);
    // One day per run: AutoCount gets slower the further into a long result it pages (invoice pages
    // went past the 5-minute timeout), and each finished day is saved even if a later one fails.
    const failed: string[] = [];
    for (let d = days; d >= 0; d--) {
      const day = dayMY(d * 864e5);
      log(`--- ${day} ---`);
      try {
        await syncOnce({ DateFrom: day, DateTo: day });
      } catch (e) {
        failed.push(day);
        log(`ERROR ${day}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (failed.length) throw new Error(`These days failed, run them again: ${failed.join(", ")}`);
    return;
  }

  log(`Syncing every ${EVERY_MIN} minutes. Ctrl+C stops it.`);
  // Carry on from the last good sync, so changes made while this PC was off or asleep aren't missed.
  const { data: last } = await supabase.from("sync_status").select("synced_at").eq("source", "autocount").maybeSingle();
  let lastSuccess: Date | null = last?.synced_at
    ? new Date(Math.max(new Date(last.synced_at).getTime(), Date.now() - MAX_CATCH_UP_DAYS * 864e5))
    : null;
  if (lastSuccess) log(`Catching up from the last sync at ${timeMY(lastSuccess)}`);

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
      // Shown on the Deliveries page as "synced 2 min ago".
      const { error } = await supabase.from("sync_status").upsert({ source: "autocount", synced_at: new Date().toISOString() });
      if (error) log(`warning could not save sync time: ${error.message}`);
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