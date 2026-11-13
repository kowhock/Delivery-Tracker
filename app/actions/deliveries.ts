"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { canEditItemNote, cleanItemNote, isIcbDo } from "@/lib/item-note";
import { OUTSOURCE_TRAILER } from "@/lib/trailer";
import { driverLabel, fmtDate, todayMY } from "@/lib/format";
import { mapsEnabled, updateDistances } from "@/lib/geo";
import { BRANCHES, branchFromDoNo, branchName, branchToSave, canPlan } from "@/lib/branches";
import { TIME_SLOTS, type DoStatus, type FormState, type Profile } from "@/lib/types";
import {
  SPECIAL_REASONS,
  canEditSpecial,
  canHandleGoods,
  canPrintSpecial,
  PRINT_HELP,
  isGoodsReason,
  isPrintReason,
  hasReferDo,
  cleanReferDo,
  isRetiredReason,
  isSpecialReason,
  parseSpecialItems,
  usesSpecialOrders,
  type SpecialItemInput,
  type SpecialReason,
} from "@/lib/special";
import { checkBranchDriver, nextTrip, notYourBranch } from "./_shared";
import { NO_POINTS_ACCESS, canEditPoints, isStaffAccess, type StaffAccess } from "@/lib/access";

// ---------- Delivery orders (staff) ----------------------------------

/**
 * Special-order fields (reason, goods items, remark) for branches that use them (lib/special.ts);
 * null for other branches, which keep the plain special DO.
 */
function readSpecialOrder(formData: FormData, branch: string | null, who: Profile, current: string | null = null) {
  if (!usesSpecialOrders(branch)) return null;
  const reason = String(formData.get("special_reason") ?? "");
  if (!isSpecialReason(reason)) throw new Error("Pick the reason for this special order.");
  if (isRetiredReason(reason) && reason !== current) throw new Error(`"${SPECIAL_REASONS[reason]}" is no longer used — pick another reason.`);
  const goods = isGoodsReason(reason);
  if (goods && !canHandleGoods(who)) throw new Error(`Only admins and dispatchers an admin has allowed can make ${SPECIAL_REASONS[reason]} special orders.`);
  const withItems = isPrintReason(reason);
  const items = withItems ? parseSpecialItems(formData) : [];
  if (withItems && !items.length) throw new Error("Add at least one item (name, UOM and quantity).");
  const referDo = hasReferDo(reason) ? cleanReferDo(String(formData.get("refer_do") ?? "")) : null;
  return { reason, items, referDo };
}

/** Replaces a special order's items with the ones keyed in. */
async function saveSpecialItems(supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"], doId: string, items: SpecialItemInput[]) {
  const { error: delError } = await supabase.from("do_items").delete().eq("do_id", doId);
  if (delError) throw new Error(delError.message);
  if (!items.length) return;
  const { error } = await supabase.from("do_items").insert(items.map((i) => ({ do_id: doId, item_code: "", description: i.description, uom: i.uom, qty: i.qty })));
  if (error) throw new Error(error.message);
}

/**
 * Runs a form save; a refusal ("Item 1: enter the quantity", …) comes back as { error } for the form
 * to show. Thrown, Next.js would hide the message in production and show only an error code.
 * Next.js's own redirects (login, the page after saving) still go through.
 */
async function formSave(save: () => Promise<string>): Promise<FormState> {
  let to: string;
  try {
    to = await save();
  } catch (e) {
    unstable_rethrow(e);
    return { error: e instanceof Error ? e.message : "Could not save." };
  }
  redirect(to);
}

/** Special DO keyed in by the office (not from AutoCount): own address, points and remark. */
export async function createSpecialDo(_prev: FormState, formData: FormData): Promise<FormState> {
  return formSave(() => saveNewSpecialDo(formData));
}

async function saveNewSpecialDo(formData: FormData): Promise<string> {
  const { supabase, profile } = await requireStaff();
  const get = (k: string) => String(formData.get(k) ?? "").trim() || null;
  const points = Number(formData.get("points")); // special DOs: everyone sets points here (lib/access.ts)
  const driverId = get("driver_id");
  const date = get("delivery_date") ?? todayMY();
  if (!get("customer_name")) throw new Error("Enter who it's delivered to.");
  if (!Number.isInteger(points) || points < 0 || points > 99) throw new Error("Points must be a whole number from 0 to 99.");
  const branch = branchToSave(profile, get("branch")); // dispatchers always create for one of their own branches
  const so = readSpecialOrder(formData, branch, profile);
  if (driverId) await checkBranchDriver(supabase, driverId, branch);

  const { data: d, error } = await supabase
    .from("delivery_orders")
    .insert({
      customer_name: get("customer_name")!,
      address: get("address"),
      contact_phone: get("contact_phone"),
      delivery_date: date,
      branch,
      driver_id: driverId,
      ...(driverId ? { trip_no: await nextTrip(supabase, driverId, date) } : {}),
      status: driverId ? "assigned" : "pending",
      instructions: get("instructions"), // shown as "Remark"
      points,
      points_manual: true,
      source: "special",
      ...(so ? { special_reason: so.reason, refer_do: so.referDo } : {}),
    })
    .select("id, do_no")
    .single();
  if (error || !d) throw new Error(error?.message ?? "Could not create the special DO");
  if (so?.items.length) await saveSpecialItems(supabase, d.id, so.items);

  const what = so ? `special order (${SPECIAL_REASONS[so.reason]})` : "special DO";
  await supabase.from("status_events").insert({ do_id: d.id, status: "do_created", note: `${d.do_no} ${what} created` });
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
  return `/deliveries?from=${date}&to=${date}`;
}

/** Special DOs can be changed until the driver starts it. Never deleted: an admin voids them. */
const SPECIAL_EDITABLE: DoStatus[] = ["pending", "assigned", "failed"];

const SPECIAL_COLUMNS = "id, do_no, source, status, branch, driver_id, delivery_date, helper_branch, created_by, special_no, special_reason, print_count, voided_at";

/** Who may change it: see canEditSpecial (goods or printed SDOs → admins + allowed dispatchers; others → any staff; void → nobody). */
async function ownSpecialDo(id: string) {
  const s = await requireStaff();
  const { data: d } = await s.supabase.from("delivery_orders").select(SPECIAL_COLUMNS).eq("id", id).single();
  if (!d || d.source !== "special") throw new Error("Special DO not found.");
  if (d.voided_at) throw new Error(`${d.do_no} is void and can't be changed.`);
  if (!canEditSpecial(d, { ...s.profile, id: s.user.id })) {
    throw new Error(
      d.print_count > 0
        ? `${d.do_no} has been printed — only admins and dispatchers an admin has allowed can change it.`
        : isGoodsReason(d.special_reason)
        ? `Only admins and dispatchers an admin has allowed can change ${SPECIAL_REASONS[d.special_reason as SpecialReason]} special orders.`
        : "Only the person who created this special DO can change it."
    );
  }
  // (Ambil Barang / System Down are open to all staff — see canEditSpecial.)
  if (!SPECIAL_EDITABLE.includes(d.status)) throw new Error(`${d.do_no} can't be changed any more — the driver has already started or delivered it.`);
  return { ...s, d };
}

export async function updateSpecialDo(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return formSave(() => saveSpecialDoChanges(id, formData));
}

async function saveSpecialDoChanges(id: string, formData: FormData): Promise<string> {
  const { supabase, profile, user, d } = await ownSpecialDo(id);
  const get = (k: string) => String(formData.get(k) ?? "").trim() || null;
  const points = Number(formData.get("points")); // special DOs: everyone sets points here (lib/access.ts)
  const driverId = get("driver_id");
  const date = get("delivery_date") ?? todayMY();
  if (!get("customer_name")) throw new Error("Enter who it's delivered to.");
  if (!Number.isInteger(points) || points < 0 || points > 99) throw new Error("Points must be a whole number from 0 to 99.");

  // A new driver (or none) resets the status like Assign does; same driver keeps it.
  const driverChanged = driverId !== d.driver_id;
  const branch = branchToSave(profile, get("branch"));
  if (usesSpecialOrders(branch) !== usesSpecialOrders(d.branch)) {
    throw new Error("Pick a branch for this special order.");
  }
  const so = readSpecialOrder(formData, branch, profile, d.special_reason);
  // Can't switch it to a reason this person isn't allowed to edit (readSpecialOrder already stops Kurang Hantar).
  if (so && !canEditSpecial({ ...d, special_reason: so.reason }, { ...profile, id: user.id })) {
    throw new Error(`You can't change ${d.do_no} to ${SPECIAL_REASONS[so.reason]}.`);
  }
  // Only a newly picked driver must be the branch's; one it already had stays.
  if (driverId && driverChanged) await checkBranchDriver(supabase, driverId, branch, d.helper_branch);
  const newTrip = driverId && (driverChanged || date !== d.delivery_date) ? { trip_no: await nextTrip(supabase, driverId, date, id), trip_seq: 0 } : {};
  const { error } = await supabase
    .from("delivery_orders")
    .update({
      customer_name: get("customer_name")!,
      address: get("address"),
      contact_phone: get("contact_phone"),
      delivery_date: date,
      branch,
      driver_id: driverId,
      ...(driverChanged ? { status: driverId ? "assigned" : "pending", failed_reason: null } : {}),
      ...newTrip,
      // "Remark" on the form. Kept in instructions, which AutoCount syncs never overwrite; a remark
      // saved in `remarks` by an earlier version was shown in the same box, so it moves over.
      instructions: get("instructions"),
      remarks: null,
      points,
      points_manual: true,
      ...(so ? { special_reason: so.reason, refer_do: so.referDo } : {}),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  if (so) await saveSpecialItems(supabase, id, so.items);

  await supabase.from("status_events").insert({ do_id: id, status: driverChanged ? (driverId ? "assigned" : "pending") : d.status, note: `${d.do_no} special DO edited` });
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
  return `/deliveries?from=${date}&to=${date}`;
}

/**
 * Admin only. The special order stays in the database, marked VOID; cancelled = true takes it out
 * of the driver's jobs, trips and points like an AutoCount-cancelled DO.
 */
export async function voidSpecialDo(id: string, reason: string) {
  const { supabase, user, profile } = await requireStaff();
  if (profile.role !== "admin") throw new Error("Only an admin can void a special order.");
  const why = reason.trim();
  if (!why) throw new Error("Enter why it's being voided.");
  const { data: d } = await supabase.from("delivery_orders").select(SPECIAL_COLUMNS).eq("id", id).single();
  if (!d || d.source !== "special") throw new Error("Special DO not found.");
  if (d.voided_at) throw new Error(`${d.do_no} is already void.`);
  const { error } = await supabase
    .from("delivery_orders")
    .update({ cancelled: true, voided_at: new Date().toISOString(), voided_by: user.id })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await supabase.from("status_events").insert({ do_id: id, status: "voided", note: `${d.do_no} voided: ${why}` });
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
}

/**
 * Called when a Kurang Hantar SDO is printed (as a Delivery Order). After the first print only admins and allowed
 * dispatchers can edit it (here and in the database); later prints are marked REPRINT. Returns the new print count.
 */
export async function recordSpecialPrint(id: string): Promise<number> {
  const { supabase, user, profile } = await requireStaff();
  const { data: d } = await supabase.from("delivery_orders").select(SPECIAL_COLUMNS).eq("id", id).single();
  if (!d || d.source !== "special") throw new Error("Special DO not found.");
  if (!canPrintSpecial(d, { ...profile, id: user.id })) {
    throw new Error(d.voided_at ? `${d.do_no} is void.` : PRINT_HELP);
  }
  const count = d.print_count + 1;
  const first = d.print_count === 0;
  const { data: saved, error } = await supabase
    .from("delivery_orders")
    .update({ print_count: count, ...(first ? { printed_at: new Date().toISOString(), printed_by: user.id } : {}) })
    .eq("id", id)
    .eq("print_count", d.print_count) // two people printing at once: one of them tries again
    .select("id");
  if (error) throw new Error(error.message);
  if (!saved?.length) throw new Error("Someone else just printed it — press Print again.");
  await supabase.from("status_events").insert({ do_id: id, status: "printed", note: first ? `${d.do_no} printed` : `${d.do_no} reprinted (copy ${count})` });
  revalidatePath("/deliveries");
  revalidatePath(`/deliveries/special/${id}`);
  return count;
}

/** Admin: ticks / unticks one permission (lib/access.ts) for a dispatcher on Admin access. */
export async function setStaffAccess(profileId: string, access: StaffAccess, allowed: boolean) {
  const { supabase, profile } = await requireStaff();
  if (profile.role !== "admin") throw new Error("Only an admin can change this.");
  if (!isStaffAccess(access)) throw new Error("Unknown permission.");
  const { data, error } = await supabase.from("profiles").update({ [access]: allowed }).eq("id", profileId).eq("role", "dispatcher").select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("That dispatcher wasn't found.");
  revalidatePath("/deliveries/special/access");
}

/**
 * Special DO keyed in while AutoCount was down → the real AutoCount DO number. The special DO
 * takes that number, so AutoCount syncs update it from now on; if the sync already brought the
 * DO in as a separate card, that card is merged into it (see link_special_do in upgrade.sql).
 */
export async function linkSpecialDo(id: string, doNo: string) {
  const { supabase, user, profile } = await requireStaff();
  const no = doNo.trim().toUpperCase();
  if (!branchFromDoNo(no)) throw new Error(`"${doNo}" isn't an AutoCount DO number (e.g. GPD-00045135).`);
  const { data: d } = await supabase.from("delivery_orders").select("do_no, so_id, source, branch, created_by, special_reason, voided_at").eq("id", id).single();
  if (!d || d.source !== "special") throw new Error("Special DO not found.");
  if (d.voided_at) throw new Error(`${d.do_no} is void.`);
  if (isGoodsReason(d.special_reason)) throw new Error(`${SPECIAL_REASONS[d.special_reason as SpecialReason]} special orders aren't AutoCount DOs and can't be linked.`);
  if (d.created_by !== user.id && profile.role !== "admin" && !canPlan(profile.branch, d.branch)) throw new Error(notYourBranch(d.branch ?? ""));

  const { error } = await supabase.rpc("link_special_do", { p_special: id, p_do_no: no });
  if (error) throw new Error(error.message);

  await supabase.from("status_events").insert({ so_id: d.so_id, do_id: id, status: "linked", note: `${d.do_no} linked to AutoCount DO ${no}` });
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
  revalidatePath("/orders/[id]", "page");
}

/** Office keys in a DO's points (e.g. the address couldn't be found). null = go back to the distance rule. */
export async function setPoints(doId: string, points: number | null) {
  const { supabase, profile } = await requireStaff();
  if (!canEditPoints(profile)) throw new Error(NO_POINTS_ACCESS);
  if (points != null && (!Number.isInteger(points) || points < 0 || points > 99)) throw new Error("Points must be 0–99.");
  const { data: before } = await supabase.from("delivery_orders").select("so_id, points").eq("id", doId).single();
  const { error } = await supabase
    .from("delivery_orders")
    .update(points == null ? { points: null, points_manual: false, geo_status: null } : { points, points_manual: true })
    .eq("id", doId);
  if (error) throw new Error(error.message);
  let now = points;
  if (points == null) {
    await updateDistances(supabase, [doId], true);
    now = (await supabase.from("delivery_orders").select("points").eq("id", doId).single()).data?.points ?? null;
  }
  const pts = (n: number | null | undefined) => (n == null ? "none" : String(n));
  await supabase.from("status_events").insert({
    so_id: before?.so_id,
    do_id: doId,
    status: "points",
    note: `Points ${pts(before?.points)} → ${pts(now)}${points == null ? " (back to the distance rule)" : ""}`,
  });
  revalidatePath("/drivers");
  revalidatePath("/deliveries");
  revalidatePath("/driver");
}

/**
 * Office types an address Google can find (when the delivery address can't be found).
 * Distance and points are worked out from it, and the driver's Waze/Maps go there.
 * null = back to the delivery address. Replaces keyed-in points.
 */
export async function setMapAddress(doId: string, address: string | null) {
  const { supabase, profile } = await requireStaff();
  if (!canEditPoints(profile)) throw new Error(NO_POINTS_ACCESS);
  if (!mapsEnabled()) throw new Error("GOOGLE_MAPS_API_KEY is not set on the server.");
  const { error } = await supabase
    .from("delivery_orders")
    .update({ map_address: address?.trim() || null, points: null, points_manual: false, geo_status: null })
    .eq("id", doId);
  if (error) throw new Error(error.message);
  await updateDistances(supabase, [doId], true);
  const { data } = await supabase.from("delivery_orders").select("points, geo_status").eq("id", doId).single();
  revalidatePath("/drivers");
  revalidatePath("/deliveries");
  revalidatePath("/driver");
  return { found: data?.points != null, status: (data?.geo_status ?? null) as string | null };
}

/** Works out distance + points for DOs that don't have points yet (e.g. after adding a store address). */
export async function calculateMissingPoints(doIds: string[]) {
  const { supabase } = await requireStaff();
  if (!mapsEnabled()) throw new Error("GOOGLE_MAPS_API_KEY is not set on the server.");
  const d = await updateDistances(supabase, doIds.slice(0, 300), true);
  revalidatePath("/drivers");
  revalidatePath("/driver");
  return d;
}

export async function assignDriver(formData: FormData) {
  const { supabase, profile } = await requireStaff();
  const doId = String(formData.get("do_id"));
  // "oc" = O/C: the customer collects, so no driver. "supplier" = the supplier delivers it: no driver,
  // and it's delivered straight away. Any other pick makes it a delivery by our drivers.
  const pick = String(formData.get("driver_id") || "");
  const oc = pick === "oc";
  const supplier = pick === "supplier";
  const driverId = oc || supplier ? null : pick || null;
  const date = String(formData.get("delivery_date") || "") || undefined;

  const { data: current } = await supabase
    .from("delivery_orders")
    .select("so_id, status, branch, helper_branch, driver_id, delivery_date, supplier_delivery")
    .eq("id", doId)
    .single();
  if (!current) return;
  if (!canPlan(profile.branch, current.branch, current.helper_branch)) throw new Error(notYourBranch(current.branch));
  const plannable = ["pending", "assigned", "failed"].includes(current.status);
  if (!plannable && !current.supplier_delivery) throw new Error("This DO is already on the road or delivered.");
  if (supplier && current.supplier_delivery) return;

  // A supplier delivery is planned again like any DO once staff pick a driver (or none) instead.
  let status: DoStatus = current.status;
  if (supplier) status = "delivered";
  else if (plannable || current.supplier_delivery) status = driverId ? "assigned" : "pending";

  // New driver or day → a trip of its own after the driver's last one; same driver and day keeps its trip.
  const day = date ?? current.delivery_date;
  const tripNo = driverId && (driverId !== current.driver_id || day !== current.delivery_date) ? await nextTrip(supabase, driverId, day, doId) : null;

  await supabase
    .from("delivery_orders")
    .update({
      driver_id: driverId,
      status,
      failed_reason: null,
      own_collection: oc,
      supplier_delivery: supplier,
      // Delivered now (set by the database); undoing a supplier delivery clears it.
      ...(current.supplier_delivery && !supplier ? { delivered_at: null } : {}),
      ...(date ? { delivery_date: date } : {}),
      ...(tripNo ? { trip_no: tripNo, trip_seq: 0 } : {}),
    })
    .eq("id", doId);

  let driverName = "nobody";
  if (driverId) {
    const { data: d } = await supabase.from("profiles").select("full_name, lorry_no").eq("id", driverId).single();
    driverName = d ? driverLabel(d) : "driver";
  }
  await supabase.from("status_events").insert({
    so_id: current.so_id,
    do_id: doId,
    status,
    note: supplier ? "Supplier delivery (delivered by the supplier)" : oc ? "Marked O/C (customer collects)" : driverId ? `Assigned to ${driverName}${tripNo ? ` · Trip ${tripNo}` : ""}` : "Unassigned",
  });

  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
  revalidatePath("/orders/[id]", "page"); // a DO can belong to several SOs
}

/**
 * Moves DOs to another delivery day (e.g. tomorrow). The driver stays on them.
 * DOs already on the road or delivered, or delivered by another branch, are skipped.
 */
export async function moveToDate(doIds: string[], date: string) {
  const { supabase, profile } = await requireStaff();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a date.");
  if (date < todayMY()) throw new Error("Deliveries can't be moved to a past date.");

  const { data } = await supabase
    .from("delivery_orders")
    .select("id, so_id, status, driver_id, delivery_date, branch, helper_branch")
    .in("id", doIds.slice(0, 200));
  const rows = (data ?? []).filter(
    (d) => ["pending", "assigned", "failed"].includes(d.status) && canPlan(profile.branch, d.branch, d.helper_branch) && d.delivery_date !== date
  );

  for (const withDriver of [true, false]) {
    const ids = rows.filter((d) => !!d.driver_id === withDriver).map((d) => d.id);
    if (!ids.length) continue;
    const { error } = await supabase
      .from("delivery_orders")
      .update({ delivery_date: date, status: withDriver ? "assigned" : "pending", failed_reason: null })
      .in("id", ids);
    if (error) throw new Error(error.message);
  }
  if (rows.length) {
    await supabase.from("status_events").insert(
      rows.map((d) => ({
        so_id: d.so_id,
        do_id: d.id,
        status: d.driver_id ? "assigned" : "pending",
        note: `Moved from ${fmtDate(d.delivery_date)} to ${fmtDate(date)}`,
      }))
    );
  }

  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
  revalidatePath("/orders/[id]", "page");
  return { moved: rows.length, skipped: doIds.length - rows.length };
}

/**
 * Failed DO goes out again: back to Assigned (same driver) or Unassigned, from today at the
 * earliest. The failed attempt stays in delivery_attempts and keeps its points. Same day and
 * driver = a new trip, so the trip rule doesn't merge it with the failed one.
 */
export async function redeliver(doId: string) {
  const { supabase, profile } = await requireStaff();
  const { data: d } = await supabase
    .from("delivery_orders")
    .select("so_id, status, branch, helper_branch, driver_id, delivery_date, trip_no")
    .eq("id", doId)
    .single();
  if (!d) throw new Error("DO not found.");
  if (d.status !== "failed") throw new Error("Only failed DOs can be redelivered.");
  if (!canPlan(profile.branch, d.branch, d.helper_branch)) throw new Error(notYourBranch(d.branch ?? ""));

  const today = todayMY();
  const date = d.delivery_date < today ? today : d.delivery_date;
  const trip = d.driver_id && date === d.delivery_date ? await nextTrip(supabase, d.driver_id, date) : 1;
  const status: DoStatus = d.driver_id ? "assigned" : "pending";
  const { error } = await supabase
    .from("delivery_orders")
    .update({ status, failed_reason: null, delivery_date: date, trip_no: trip, trip_seq: 0 })
    .eq("id", doId);
  if (error) throw new Error(error.message);

  await supabase.from("status_events").insert({
    so_id: d.so_id,
    do_id: doId,
    status,
    note: `Redeliver on ${fmtDate(date)}`,
  });
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
  revalidatePath("/orders/[id]", "page");
}

/**
 * O/C: the customer collected at the store. Counts as delivered (no driver, so no commission).
 * `at` = when ("2026-10-29T15:30", Malaysia time); null = now. collected = false undoes it.
 */
export async function setCollected(doId: string, collected: boolean, at: string | null = null) {
  const { supabase, profile } = await requireStaff();
  const { data: d } = await supabase.from("delivery_orders").select("so_id, status, branch, helper_branch, is_oc").eq("id", doId).single();
  if (!d) throw new Error("DO not found.");
  if (!d.is_oc) throw new Error("Only O/C DOs can be marked collected.");
  if (!canPlan(profile.branch, d.branch, d.helper_branch)) throw new Error(notYourBranch(d.branch ?? ""));

  let when: string | null = null;
  if (collected && at) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) throw new Error("Pick when it was collected.");
    when = new Date(`${at}:00+08:00`).toISOString();
    if (when > new Date().toISOString()) throw new Error("Collection time can't be in the future.");
  }

  const update = collected ? { status: "delivered", failed_reason: null } : { status: "pending", delivered_at: null };
  const { error } = await supabase.from("delivery_orders").update(update).eq("id", doId);
  if (error) throw new Error(error.message);
  // The database stamps delivered_at with now(); a picked time replaces it afterwards.
  if (when) await supabase.from("delivery_orders").update({ delivered_at: when }).eq("id", doId);

  await supabase.from("status_events").insert({
    so_id: d.so_id,
    do_id: doId,
    status: collected ? "delivered" : "pending",
    note: collected ? "Collected by customer (O/C)" : "O/C collection undone",
  });
  revalidatePath("/deliveries");
  revalidatePath("/orders/[id]", "page");
}

/** Optional estimated delivery window for a DO (e.g. 1–3pm). null = no estimate. */
export async function setTimeSlot(doId: string, slot: string | null) {
  const { supabase, profile } = await requireStaff();
  if (slot != null && !(slot in TIME_SLOTS)) throw new Error("Pick a time slot.");
  const { data: d } = await supabase.from("delivery_orders").select("branch, helper_branch").eq("id", doId).single();
  if (!d) throw new Error("DO not found.");
  if (!canPlan(profile.branch, d.branch, d.helper_branch)) throw new Error(notYourBranch(d.branch ?? ""));
  const { error } = await supabase.from("delivery_orders").update({ time_slot: slot }).eq("id", doId);
  if (error) throw new Error(error.message);
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
  revalidatePath("/orders/[id]", "page");
}

/**
 * Hands a DO over to another branch, which helps deliver it: that branch then sees it and
 * picks its driver, while the DO's own branch keeps seeing (and planning) it. null takes it back.
 * Only the DO's own branch hands over, and only while no driver is on it, so a driver is never
 * left on a DO their branch can no longer see. Points stay measured from the DO's own store.
 */
export async function setHelperBranch(doId: string, helper: string | null) {
  const { supabase, profile } = await requireStaff();
  const { data: d } = await supabase
    .from("delivery_orders")
    .select("so_id, status, branch, helper_branch, driver_id, is_oc, cancelled")
    .eq("id", doId)
    .single();
  if (!d) throw new Error("DO not found.");
  if (!d.branch) throw new Error("This DO has no branch, so any branch can plan it already.");
  if (!canPlan(profile.branch, d.branch)) throw new Error(`Only ${branchName(d.branch)} can hand this DO over.`);
  if (helper !== null && (helper === d.branch || !BRANCHES.some((b) => b.code === helper && b.store))) throw new Error("Pick another branch.");
  if (helper === d.helper_branch) return;
  if (d.cancelled) throw new Error("This DO is cancelled in AutoCount.");
  if (d.is_oc) throw new Error("O/C DOs are collected at the store, so they can't be handed over.");
  if (!["pending", "assigned", "failed"].includes(d.status)) throw new Error("This DO is already on the road or delivered.");
  if (d.driver_id) throw new Error("Take the driver off this DO first.");

  const { error } = await supabase.from("delivery_orders").update({ helper_branch: helper }).eq("id", doId);
  if (error) throw new Error(error.message);
  await supabase.from("status_events").insert({
    so_id: d.so_id,
    do_id: doId,
    status: d.status,
    note: helper ? `Handed over to ${branchName(helper)} to deliver` : `Taken back from ${branchName(d.helper_branch)}`,
  });
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
}

/**
 * "Mark cancelled": the DO was cancelled (or deleted) in AutoCount but the sync missed it, so it
 * still waits on the board. The DO's own branch or an admin marks it, with a reason; it then counts
 * as cancelled everywhere. The database keeps it cancelled through later syncs (keep_office_cancel).
 * AutoCount DOs only (special DOs are voided by an admin), and only before it's out for delivery.
 */
async function officeCancelDo(doId: string) {
  const { supabase, user, profile } = await requireStaff();
  const { data: d } = await supabase
    .from("delivery_orders")
    .select("so_id, do_no, source, status, branch, cancelled, office_cancelled_at")
    .eq("id", doId)
    .single();
  if (!d) throw new Error("DO not found.");
  if (profile.role !== "admin" && !canPlan(profile.branch, d.branch)) throw new Error(`Only ${branchName(d.branch)} or an admin can do this.`);
  return { supabase, user, d };
}

export async function markDoCancelled(doId: string, reason: string) {
  const why = reason.trim();
  if (!why) throw new Error("Enter why it's cancelled.");
  if (why.length > 200) throw new Error("Keep the reason under 200 characters.");
  const { supabase, user, d } = await officeCancelDo(doId);
  if (d.source !== "autocount") throw new Error("Special DOs are voided by an admin instead.");
  if (d.cancelled) throw new Error(`${d.do_no} is already cancelled.`);
  if (!["pending", "assigned", "failed"].includes(d.status)) throw new Error("This DO is already on the road or delivered.");
  const { error } = await supabase
    .from("delivery_orders")
    .update({ office_cancelled_at: new Date().toISOString(), office_cancelled_by: user.id, office_cancel_reason: why, cancelled: true })
    .eq("id", doId);
  if (error) throw new Error(error.message);
  await supabase.from("status_events").insert({ so_id: d.so_id, do_id: doId, status: d.status, note: `Marked cancelled (missed from AutoCount): ${why}` });
  revalidateBoards();
}

/** Undoes "Mark cancelled": back on the board as it was. A later AutoCount sync still applies AutoCount's own Cancelled. */
export async function undoDoCancelled(doId: string) {
  const { supabase, d } = await officeCancelDo(doId);
  if (!d.office_cancelled_at) return;
  const { error } = await supabase
    .from("delivery_orders")
    .update({ office_cancelled_at: null, office_cancelled_by: null, office_cancel_reason: null, cancelled: false })
    .eq("id", doId);
  if (error) throw new Error(error.message);
  await supabase.from("status_events").insert({ so_id: d.so_id, do_id: doId, status: d.status, note: "Mark cancelled undone" });
  revalidateBoards();
}

function revalidateBoards() {
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
  revalidatePath("/outstanding");
  revalidatePath("/trip-form");
}

/**
 * "Assign other branch" → Trailer: the DO is delivered by a trailer (shared by every branch, no
 * driver), so it is delivered right away, with no driver and so no points or commission.
 * OUTSOURCE_TRAILER instead of a trailer id = an outside company's trailer (no lorry in the app).
 * null = Take back: the DO goes back to Unassigned. The DO's own branch only, like a hand-over.
 */
export async function setTrailer(doId: string, trailerId: string | null) {
  const { supabase, profile } = await requireStaff();
  const { data: d } = await supabase
    .from("delivery_orders")
    .select("so_id, status, branch, driver_id, is_oc, cancelled, voided_at, trailer_id, outsource_trailer")
    .eq("id", doId)
    .single();
  if (!d) throw new Error("DO not found.");
  if (!canPlan(profile.branch, d.branch)) throw new Error(`Only ${branchName(d.branch)} can put this DO on a trailer.`);
  if (d.cancelled || d.voided_at) throw new Error("This DO is cancelled.");
  const current: string | null = d.outsource_trailer ? OUTSOURCE_TRAILER : d.trailer_id;
  if (trailerId === current) return;

  if (trailerId === null) {
    // Undo: back to Unassigned, not delivered.
    const { data: t } = d.trailer_id ? await supabase.from("lorries").select("lorry_no").eq("id", d.trailer_id).maybeSingle() : { data: null };
    const { error } = await supabase
      .from("delivery_orders")
      .update({ trailer_id: null, outsource_trailer: false, lorry_id: null, status: "pending", delivered_at: null })
      .eq("id", doId);
    if (error) throw new Error(error.message);
    const from = d.outsource_trailer ? "outsource trailer" : `trailer ${t?.lorry_no ?? ""}`.trim();
    await supabase.from("status_events").insert({ so_id: d.so_id, do_id: doId, status: "pending", note: `Taken back from ${from}` });
  } else {
    if (d.is_oc) throw new Error("O/C DOs are collected at the store, so they can't go on a trailer.");
    if (d.driver_id) throw new Error("Take the driver off this DO first.");
    // Changing from one trailer to another keeps it delivered; otherwise it must still be waiting.
    if (!current && !["pending", "assigned", "failed"].includes(d.status)) throw new Error("This DO is already on the road or delivered.");
    if (trailerId === OUTSOURCE_TRAILER) {
      const { error } = await supabase
        .from("delivery_orders")
        .update({
          trailer_id: null,
          outsource_trailer: true,
          lorry_id: null,
          status: "delivered", // delivered now (delivered_at set by the database)
          helper_branch: null,
          supplier_delivery: false,
          failed_reason: null,
        })
        .eq("id", doId);
      if (error) throw new Error(error.message);
      await supabase.from("status_events").insert({ so_id: d.so_id, do_id: doId, status: "delivered", note: "Delivered by outsource trailer" });
      revalidatePath("/deliveries");
      revalidatePath("/drivers");
      return;
    }
    const { data: t } = await supabase.from("lorries").select("id, lorry_no, is_trailer").eq("id", trailerId).maybeSingle();
    if (!t?.is_trailer) throw new Error("Pick a trailer.");
    const { error } = await supabase
      .from("delivery_orders")
      .update({
        trailer_id: t.id,
        outsource_trailer: false,
        lorry_id: t.id,
        status: "delivered", // delivered now (delivered_at set by the database)
        helper_branch: null,
        supplier_delivery: false,
        failed_reason: null,
      })
      .eq("id", doId);
    if (error) throw new Error(error.message);
    await supabase.from("status_events").insert({ so_id: d.so_id, do_id: doId, status: "delivered", note: `Delivered by trailer ${t.lorry_no}` });
  }
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/lorries");
}

/**
 * M- DOs (inter-company invoices): the office types the items, one per line ("Cement x 1 bag"), since
 * AutoCount sends none for invoices. Admins and the delivering (or helping) branch, until delivered.
 * Returns why not instead of throwing, so the message isn't hidden in production. lib/item-note.ts.
 */
export async function saveItemNote(doId: string, text: string): Promise<FormState> {
  try {
    const { supabase, profile } = await requireStaff();
    const note = cleanItemNote(text);
    const { data: d } = await supabase.from("delivery_orders").select("id, do_no, status, branch, helper_branch, cancelled, item_note").eq("id", doId).single();
    if (!d) return { error: "DO not found." };
    if (!isIcbDo(d.do_no)) return { error: "Items can only be typed on M- DOs." };
    if (d.status === "delivered") return { error: `${d.do_no} is delivered — its items can't change any more.` };
    if (!canEditItemNote(d, profile)) return { error: notYourBranch(d.branch ?? "") };
    if (note === d.item_note) return undefined;
    const { error } = await supabase.from("delivery_orders").update({ item_note: note }).eq("id", doId);
    if (error) return { error: error.message };
    await supabase.from("status_events").insert({ do_id: doId, status: d.status, note: `${d.do_no} items ${note ? "typed" : "cleared"}` });
  } catch (e) {
    unstable_rethrow(e);
    return { error: e instanceof Error ? e.message : "Could not save." };
  }
  revalidatePath("/deliveries");
  revalidatePath("/drivers");
  revalidatePath("/driver");
  return undefined;
}
