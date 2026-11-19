/**
 * AutoCount → Supabase sync of delivery orders. Only READS from AutoCount (deliveryorder/select, invoice/select).
 * Inter-company invoices (M-PT-…) are delivered like DOs, so they're synced as DOs too.
 * Runs on a computer in the office network (the AutoCount API is at a 192.168.x.x address).
 *
 *   npm run autocount:sync -- --days 14   one time: DOs dated in the last 14 days, day by day (backfill)
 *   npm run autocount:sync -- --days 14 --book UT,CG   the same, only those branches' account books
 *                                         (branch code or database name; "M" = the main book)
 *   npm run autocount:sync                keeps running: every 5 minutes, DOs changed since the last run
 *
 * Reads every account book in turn (acBooks(): the M book, then each branch with its own book). A book that
 * fails doesn't stop the others; it keeps its own "last synced" time and catches up on the next run.
 *
 * Signs in to Supabase as the staff user in SUPABASE_SYNC_EMAIL / SUPABASE_SYNC_PASSWORD.
 */
import { createClient } from "@supabase/supabase-js";
import { acBooks, fetchAcDeliveryOrders, fetchAcIcbDeliveryOrders, type AcBook, type AcSelectFilter } from "../lib/autocount-api";
import { branchName } from "../lib/branches";
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

async function signIn() {
  const { error } = await supabase.auth.signInWithPassword({
    email: need("SUPABASE_SYNC_EMAIL"),
    password: need("SUPABASE_SYNC_PASSWORD"),
  });
  if (error) throw new Error(`Supabase sign-in: ${error.message}`);
}

/**
 * Before every run: still signed in? The login can be ended from elsewhere (a password change, or
 * "sign out everywhere" with this same account), and then every save is refused as row-level
 * security. If it's gone, sign in again, so the sync mends itself instead of failing until restarted.
 */
async function ensureSignedIn() {
  const { data, error } = await supabase.auth.getUser();
  if (!error && data.user) return;
  log(`Supabase login lost (${error?.message ?? "no user"}), signing in again…`);
  await signIn();
  log("Signed in again");
}

/** A save refused because of the login (not because of one bad row): the run must count as failed. */
const LOGIN_PROBLEM = /row-level security|JWT|not authenticated|permission denied|refresh token/i;

// Save → log → work out distances. Called once per document kind, so DOs are saved before the slow invoice read.
async function save(what: string, rows: AcDeliveryOrder[]) {
  const d = await importAcDeliveryOrders(supabase, rows);
  log(`${what}: ${rows.length} read, ${d.created.length} new, ${d.updated.length} updated`);

  for (const m of d.errors) log(`ERROR ${m}`);
  for (const m of d.warnings) log(`warning ${m}`);
  // Nothing was saved: don't let this run count as done, or its DOs would be skipped by the next one.
  const refused = d.errors.find((m) => LOGIN_PROBLEM.test(m));
  if (refused) throw new Error(`the database refused the save (${refused})`);

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

const bookName = (b: AcBook) => (b.branch ? `${branchName(b.branch)} (${b.db})` : `M book (${b.db})`);

// sync_status rows: one per book ("autocount:AED_KHCG"), plus "autocount" = every book synced (the Deliveries page shows it).
const statusKey = (b: AcBook) => `autocount:${b.db}`;

async function syncOnce(filter: AcSelectFilter, book: AcBook) {
  const t0 = Date.now();
  const name = bookName(book);

  log(`${name}: reading DOs…`);
  await save(`${name} DO`, await fetchAcDeliveryOrders(filter, book));
  if (book.icbPrefixes.length) {
    log(`${name}: reading inter-company invoices (${book.icbPrefixes.map((p) => `${p}…`).join(", ")})…`);
    await save(`${name} inter-company invoice`, await fetchAcIcbDeliveryOrders(filter, book));
  }

  log(`${name}: done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

/** --book UT,CG / --book AED_KHCG / --book M → only those books. */
function pickBooks(): AcBook[] {
  const all = acBooks();
  const i = process.argv.indexOf("--book");
  if (i < 0) return all;
  const wanted = (process.argv[i + 1] ?? "").split(",").map((w) => w.trim().toUpperCase()).filter(Boolean);
  const picked = all.filter((b) => wanted.some((w) => w === b.db.toUpperCase() || w === (b.branch ?? "M")));
  if (!picked.length) throw new Error(`--book: none of "${wanted.join(",")}" is an account book. Books: ${all.map((b) => `${b.branch ?? "M"} (${b.db})`).join(", ")}`);
  return picked;
}

async function main() {
  log("Signing in to Supabase…");
  await signIn();
  const books = pickBooks();
  log(`Account books: ${books.map(bookName).join(", ")}`);

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
      for (const book of books) {
        try {
          await ensureSignedIn();
          await syncOnce({ DateFrom: day, DateTo: day }, book);
        } catch (e) {
          failed.push(`${day} ${book.branch ?? "M"}`);
          log(`ERROR ${day} ${bookName(book)}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    if (failed.length) throw new Error(`These days failed, run them again (with --book): ${failed.join(", ")}`);
    return;
  }

  log(`Syncing every ${EVERY_MIN} minutes. Ctrl+C stops it.`);
  // Carry on from each book's last good sync, so changes made while this PC was off or asleep aren't missed.
  // The M book synced before account books were split keeps going from the old "autocount" time.
  const { data: rows } = await supabase.from("sync_status").select("source, synced_at").like("source", "autocount%");
  const lastAt = new Map((rows ?? []).map((r) => [r.source as string, new Date(r.synced_at as string)]));
  const lastSuccess = new Map<string, Date | null>();
  for (const book of books) {
    const last = lastAt.get(statusKey(book)) ?? (book.branch ? undefined : lastAt.get("autocount"));
    lastSuccess.set(book.db, last ? new Date(Math.max(last.getTime(), Date.now() - MAX_CATCH_UP_DAYS * 864e5)) : null);
    log(last ? `${bookName(book)}: catching up from ${timeMY(last)}` : `${bookName(book)}: first run, reading the last ${FIRST_RUN_HOURS} hours`);
  }

  for (;;) {
    const startedAt = new Date();
    const done: string[] = [];
    for (const book of books) {
      const last = lastSuccess.get(book.db);
      const from = last ? new Date(last.getTime() - OVERLAP_MIN * 60e3) : new Date(startedAt.getTime() - FIRST_RUN_HOURS * 3600e3);
      const filter = { LastModifiedFrom: timeMY(from), LastModifiedTo: timeMY(startedAt) };
      log(`${bookName(book)}: changes from ${filter.LastModifiedFrom} to ${filter.LastModifiedTo}`);
      try {
        await ensureSignedIn();
        await syncOnce(filter, book);
        lastSuccess.set(book.db, startedAt); // only move forward when the whole run for this book worked
        done.push(book.db);
      } catch (e) {
        log(`ERROR ${bookName(book)}: ${e instanceof Error ? e.message : e} — next run will cover this gap`);
      }
    }

    // One write for the whole run, so open Deliveries pages refresh once. "autocount" ("synced 2 min ago" on
    // the Deliveries page) only moves when every book worked — so a failing book shows up as an old sync time.
    const now = new Date().toISOString();
    // A book's own row keeps when its run started (what the next run carries on from, as lastSuccess does).
    const status = books.filter((b) => done.includes(b.db)).map((b) => ({ source: statusKey(b), synced_at: startedAt.toISOString() }));
    if (done.length === books.length && books.length === acBooks().length) status.push({ source: "autocount", synced_at: now });
    if (status.length) {
      const { error } = await supabase.from("sync_status").upsert(status);
      if (error) log(`warning could not save sync time: ${error.message}`);
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