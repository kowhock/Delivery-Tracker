import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { branchFromDoNo, branchFromLocation } from "./branches";
import { splitDocNos, type AcDeliveryOrder, type AcImportResult, type AcSalesOrder } from "./autocount-rows";
import { todayMY } from "./format";

/**
 * THE entry point for AutoCount documents (Excel export today, API later).
 * - Matched by Doc. No., so importing the same file again updates instead of duplicating.
 * - Only AutoCount's own fields are written on update; driver, trip, status and
 *   delivery date set in this app are never overwritten.
 * - SO ↔ DO links come from DO "Transfer From" (and SO "Transfer To"), many-to-many.
 */

// Until item lines are imported from AutoCount, every new SO/DO gets this test item.
const TEST_ITEM = { item_code: "10100101", description: "Cement 50kg", uom: "BAG", qty: 2 };

const CHUNK = 200;
const chunks = <T,>(a: T[]) => Array.from({ length: Math.ceil(a.length / CHUNK) }, (_, i) => a.slice(i * CHUNK, (i + 1) * CHUNK));

function dedupe<T extends { doc_no: string; debtor_name: string | null }>(rows: T[], result: AcImportResult): T[] {
  const byNo = new Map<string, T>();
  rows.forEach((r, i) => {
    if (!r.doc_no) return result.errors.push(`Row ${i + 2}: missing Doc. No.`);
    if (!r.debtor_name) return result.errors.push(`${r.doc_no}: missing Debtor Name`);
    byNo.set(r.doc_no.trim().toUpperCase(), { ...r, doc_no: r.doc_no.trim().toUpperCase() });
  });
  return [...byNo.values()];
}

async function existingIds(supabase: SupabaseClient, table: "sales_orders" | "delivery_orders", col: "so_no" | "do_no", nos: string[]) {
  const found = new Map<string, string>();
  for (const part of chunks(nos)) {
    const { data, error } = await supabase.from(table).select(`id, ${col}`).in(col, part);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Record<string, string>[]) found.set(r[col], r.id);
  }
  return found;
}

async function syncLinks(supabase: SupabaseClient, result: AcImportResult) {
  const { error } = await supabase.rpc("sync_autocount_links");
  if (error) result.errors.push(`Linking SOs and DOs: ${error.message}. Has supabase/upgrade.sql been run?`);
}

// ---------- Sales orders ----------------------------------------------

export async function importAcSalesOrders(supabase: SupabaseClient, input: AcSalesOrder[]): Promise<AcImportResult> {
  const result: AcImportResult = { created: [], updated: [], warnings: [], errors: [] };
  const rows = dedupe(input, result);
  if (!rows.length) return result;

  const before = await existingIds(supabase, "sales_orders", "so_no", rows.map((r) => r.doc_no));
  const now = new Date().toISOString();
  const saved = new Map<string, string>();

  for (const part of chunks(rows)) {
    const { data, error } = await supabase
      .from("sales_orders")
      .upsert(
        part.map((r) => ({
          so_no: r.doc_no,
          so_date: r.date ?? todayMY(),
          debtor_code: r.debtor_code,
          customer_name: r.debtor_name!,
          phone: r.delivery_phone,
          address: r.delivery_address,
          branch: branchFromLocation(r.sales_location, r.doc_no),
          sales_location: r.sales_location,
          agent: r.agent,
          credit_term: r.credit_term,
          total: r.total,
          remarks: r.remark,
          transfer_to: r.transfer_to,
          icb_from_po: r.icb_from_po,
          created_user: r.created_user,
          ac_created_at: r.created_time,
          source: "autocount",
          updated_at: now,
        })),
        { onConflict: "so_no" }
      )
      .select("id, so_no");
    if (error) {
      result.errors.push(error.code === "23505"
        ? `Some SO numbers already exist with different upper/lower case: ${error.message}`
        : `Saving SOs: ${error.message}`);
      continue;
    }
    for (const r of data ?? []) saved.set(r.so_no, r.id);
  }

  const created = [...saved.entries()].filter(([no]) => !before.has(no));
  result.created = created.map(([no]) => no);
  result.updated = [...saved.keys()].filter((no) => before.has(no));

  if (created.length) {
    await supabase.from("so_items").insert(created.map(([, id]) => ({ so_id: id, line_no: 1, ...TEST_ITEM })));
    await supabase.from("status_events").insert(
      created.map(([, id]) => ({ so_id: id, status: "so_created", note: "Imported from AutoCount" }))
    );
  }

  // SO "Transfer To" → link to DOs that are already in the system.
  const wanted = rows.flatMap((r) => splitDocNos(r.transfer_to).map((doNo) => ({ so_no: r.doc_no, do_no: doNo })));
  if (wanted.length) {
    const dos = await existingIds(supabase, "delivery_orders", "do_no", [...new Set(wanted.map((w) => w.do_no))]);
    const links = wanted.filter((w) => dos.has(w.do_no)).map((w) => ({ do_id: dos.get(w.do_no)!, so_no: w.so_no }));
    for (const part of chunks(links)) {
      const { error } = await supabase.from("do_sales_orders").upsert(part, { onConflict: "do_id,so_no", ignoreDuplicates: true });
      if (error) result.errors.push(`Linking DOs: ${error.message}`);
    }
  }

  await syncLinks(supabase, result);
  return result;
}

// ---------- Delivery orders -------------------------------------------

export async function importAcDeliveryOrders(supabase: SupabaseClient, input: AcDeliveryOrder[]): Promise<AcImportResult> {
  const result: AcImportResult = { created: [], updated: [], warnings: [], errors: [] };
  const rows = dedupe(input, result);
  if (!rows.length) return result;

  const before = await existingIds(supabase, "delivery_orders", "do_no", rows.map((r) => r.doc_no));
  const saved = new Map<string, string>();

  // AutoCount-owned fields only. delivery_date/driver/trip/status stay as the office set them.
  const fields = (r: AcDeliveryOrder) => ({
    do_no: r.doc_no,
    so_no: splitDocNos(r.transfer_from).join(", "),
    customer_name: r.debtor_name!,
    address: r.delivery_address,
    branch: branchFromDoNo(r.doc_no),
    sales_branch: branchFromLocation(r.sales_location),
    ref: r.ref,
    total: r.total,
    invoice_no: r.transfer_to,
    created_user: r.created_user,
    cancelled: r.cancelled,
    source: "autocount",
  });

  const fresh = rows.filter((r) => !before.has(r.doc_no));
  const old = rows.filter((r) => before.has(r.doc_no));
  for (const part of chunks(fresh)) {
    const { data, error } = await supabase
      .from("delivery_orders")
      .insert(part.map((r) => ({ ...fields(r), contact_phone: r.phone, delivery_date: r.date ?? todayMY() })))
      .select("id, do_no");
    if (error) {
      result.errors.push(error.code === "23505"
        ? `Some DO numbers already exist with different upper/lower case: ${error.message}`
        : `Saving DOs: ${error.message}`);
      continue;
    }
    for (const r of data ?? []) saved.set(r.do_no, r.id);
  }
  for (const part of chunks(old)) {
    const { data, error } = await supabase
      .from("delivery_orders")
      .upsert(part.map(fields), { onConflict: "do_no" })
      .select("id, do_no");
    if (error) {
      result.errors.push(`Updating DOs: ${error.message}`);
      continue;
    }
    for (const r of data ?? []) saved.set(r.do_no, r.id);
  }

  const created = [...saved.entries()].filter(([no]) => !before.has(no));
  result.created = created.map(([no]) => no);
  result.updated = [...saved.keys()].filter((no) => before.has(no));

  // Item lines: the AutoCount API sends them, so replace them on every sync.
  // The Excel export has none: new DOs get the test item instead.
  const withItems = rows.filter((r) => r.items && saved.has(r.doc_no));
  for (const part of chunks(withItems.map((r) => saved.get(r.doc_no)!))) await supabase.from("do_items").delete().in("do_id", part);
  const lines = withItems.flatMap((r) => r.items!.filter((i) => i.qty > 0).map((i) => ({ do_id: saved.get(r.doc_no)!, ...i })));
  for (const part of chunks(lines)) {
    const { error } = await supabase.from("do_items").insert(part);
    if (error) result.errors.push(`Saving DO items: ${error.message}`);
  }
  const noItems = created.filter(([no]) => !rows.find((r) => r.doc_no === no)?.items);
  if (noItems.length) await supabase.from("do_items").insert(noItems.map(([, id]) => ({ do_id: id, ...TEST_ITEM })));

  if (created.length) {
    await supabase.from("status_events").insert(
      created.map(([, id]) => ({ do_id: id, status: "do_created", note: "Imported from AutoCount" }))
    );
  }

  // DO "Transfer From" is the full list of its SOs: replace the links.
  const ids = [...saved.values()];
  for (const part of chunks(ids)) await supabase.from("do_sales_orders").delete().in("do_id", part);
  const links = rows
    .filter((r) => saved.has(r.doc_no))
    .flatMap((r) => splitDocNos(r.transfer_from).map((soNo) => ({ do_id: saved.get(r.doc_no)!, so_no: soNo })));
  for (const part of chunks(links)) {
    const { error } = await supabase.from("do_sales_orders").insert(part);
    if (error) result.errors.push(`Linking SOs: ${error.message}`);
  }

  await syncLinks(supabase, result);

  // One DO may combine several SOs, but only of the same debtor.
  const debtorOf = new Map(rows.map((r) => [r.doc_no, r.debtor_code]));
  for (const part of chunks(ids)) {
    const { data } = await supabase
      .from("do_sales_orders")
      .select("so_no, do:delivery_orders!inner(do_no), so:sales_orders(debtor_code)")
      .in("do_id", part);
    for (const l of (data ?? []) as unknown as { so_no: string; do: { do_no: string }; so: { debtor_code: string | null } | null }[]) {
      const doDebtor = debtorOf.get(l.do.do_no);
      if (l.so?.debtor_code && doDebtor && l.so.debtor_code !== doDebtor) {
        result.warnings.push(`${l.do.do_no} (debtor ${doDebtor}) is linked to ${l.so_no} of a different debtor (${l.so.debtor_code}).`);
      }
    }
  }
  const cancelled = rows.filter((r) => r.cancelled).map((r) => r.doc_no);
  if (cancelled.length) result.warnings.push(`Cancelled in AutoCount (hidden from deliveries): ${cancelled.join(", ")}`);

  return result;
}
