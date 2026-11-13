import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { driverLabel, fmtDate, fmtDateTime, fmtTime, mapAddress, todayMY, weekRange } from "@/lib/format";
import { withStartedAt } from "@/lib/delivery-times";
import { BRANCHES, branchName, canPlan, deliveredOrSoldBy, driversForBranch, lockedBranches, pageBranch, userBranches } from "@/lib/branches";
import { DO_STATUSES, TIME_SLOTS, lorryLabel, type DeliveryOrder, type DoStatus, type Lorry, type Outstanding, type Profile } from "@/lib/types";
import { getStaffT } from "@/lib/staff-lang";
import { AssignDriver } from "@/components/AssignDriver";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { SyncAge } from "@/components/SyncAge";
import { BranchTags } from "@/components/DocLinks";
import { DateRangePicker } from "@/components/DateRangePicker";
import { SearchIcon } from "@/components/Icons";
import { DoDate, DoTimeSlot } from "@/components/MoveDate";
import { DoOutstanding } from "@/components/Outstanding";
import { OcCollect } from "@/components/OcCollect";
import { Redeliver } from "@/components/Redeliver";
import { LinkSpecialDo } from "@/components/LinkSpecialDo";
import { SPECIAL_REASONS, canEditSpecial, canPrintSpecial, isGoodsReason, isSpecialReason } from "@/lib/special";
import { NavForm, NavLink, NavSelect, PendingDim, PendingNav, PendingSpinner } from "@/components/PendingNav";
import { ItemNote } from "@/components/ItemNote";
import { ColumnTabs } from "@/components/ColumnTabs";
import { OUTSOURCE_TRAILER } from "@/lib/trailer";
import { canEditItemNote, isIcbDo } from "@/lib/item-note";

const COLUMN_DOT: Record<DoStatus, string> = {
  pending: "bg-slate-400",
  assigned: "bg-sky-500",
  out_for_delivery: "bg-amber-500",
  delivered: "bg-emerald-500",
  failed: "bg-rose-500",
};

// Failed DOs only show under their own filter, so the other columns get the room.
const DELIVERY_FILTERS = {
  "": { statuses: DO_STATUSES.filter((s) => s !== "failed") },
  undelivered: { statuses: DO_STATUSES.filter((s) => s !== "delivered" && s !== "failed") },
  delivered: { statuses: ["delivered"] as DoStatus[] },
  failed: { statuses: ["failed"] as DoStatus[] },
};
type DeliveryFilter = keyof typeof DELIVERY_FILTERS;

// "Also show": DOs our drivers don't deliver, hidden unless picked. Labels: t.deliveries.extras.
const EXTRAS = { "": true, oc: true, supplier: true };
type Extra = keyof typeof EXTRAS;

const PAGE = 300; // DOs loaded at a time
const MAX_LOADED = 3000;

const PLANNABLE: DoStatus[] = ["pending", "assigned", "failed"];


const GRID_COLS = ["", "lg:grid-cols-1", "lg:grid-cols-2", "lg:grid-cols-3", "lg:grid-cols-4", "lg:grid-cols-5", "lg:grid-cols-6", "lg:grid-cols-7"];

// Phones: roomier tabs; tab groups take the whole row with the tabs sharing it evenly.
const TAB = "rounded-md px-2 py-1.5 text-xs font-medium whitespace-nowrap sm:py-1";
const TAB_GROUP = "flex w-full rounded-lg bg-slate-100 p-0.5 sm:w-auto";
const TAB_FILL = "flex-1 text-center sm:flex-none";
const TAB_ON = "bg-white text-slate-900 shadow-sm";
const TAB_OFF = "text-slate-500 hover:text-slate-900";

/** "/deliveries?…" — undefined params are left out, "" is kept (from=&to= means all dates). */
function href(params: Record<string, string | undefined>) {
  const qs = Object.entries(params)
    .filter((e): e is [string, string] => e[1] !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return qs ? `/deliveries?${qs}` : "/deliveries";
}

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; show?: string; q?: string; oc?: string; extra?: string; branch?: string; xb?: string; n?: string }>;
}) {
  const sp = await searchParams;
  const today = todayMY();
  // Opening the page (no from/to in the URL) always shows today. Once staff
  // pick dates, those are used — both left blank means all dates.
  const picked = sp.from !== undefined || sp.to !== undefined;
  const from = picked ? sp.from || "" : today;
  const to = picked ? (sp.to && (!from || sp.to >= from) ? sp.to : "") : today;
  const show: DeliveryFilter = sp.show && sp.show in DELIVERY_FILTERS ? (sp.show as DeliveryFilter) : "";
  const q = (sp.q ?? "").trim();
  // Search text, safe inside a PostgREST or(…) filter.
  const term = q.replace(/[,()%*"\\:]/g, " ").replace(/\s+/g, " ").trim();
  // A search only looks inside the DOs the filters show (dates, status, branch, Also show).
  const statuses = DELIVERY_FILTERS[show].statuses;
  // O/C (customer collects) and Supplier delivery are hidden unless staff pick them under "Also show".
  // (?oc=show is the old link for O/C.)
  const extra: Extra = sp.extra && sp.extra in EXTRAS ? (sp.extra as Extra) : sp.oc === "show" ? "oc" : "";
  const showOc = extra === "oc";
  const showSupplier = extra === "supplier";
  // Cross-branch: DOs this branch sold that another branch is delivering.
  const crossOnly = sp.xb === "1";
  const { supabase, user, profile } = await requireStaff();
  const { t } = await getStaffT();
  const T = t.deliveries;
  const date = (d: string) => fmtDate(d, t.locale);
  // What's outstanding: a typed "other" to-do stays as typed; the fixed ones are translated.
  const todoText = (o: Pick<Outstanding, "todo" | "todo_other">) => (o.todo === "other" && o.todo_other ? o.todo_other : t.todo[o.todo]);
  // Opens on the user's own branch, like Driver status. Dispatchers can't switch away from theirs.
  const locked = lockedBranches(profile);
  const pickedBranch = pageBranch(sp.branch, profile);
  const branch = BRANCHES.some((b) => b.code === pickedBranch) ? pickedBranch : "";

  // No dates picked = every delivery; otherwise only deliveries dated inside the range.
  // A search (DO no., customer / debtor name or address) narrows the DOs these filters show.
  // The page's filters, used for the cards and for the delivered count.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filtered = <Q extends Record<"eq" | "in" | "or" | "ilike" | "gte" | "lte" | "neq", any>>(query: Q, st: DoStatus[] = statuses, withVoid = false): Q => {
    // Voided special orders stay on the board (marked VOID) but out of the counts.
    // DOs marked cancelled in the app come back only in a search, so they can be found and undone.
    query = (withVoid ? query.or(`cancelled.eq.false,voided_at.not.is.null${term ? ",office_cancelled_at.not.is.null" : ""}`) : query.eq("cancelled", false)).in("status", st);
    if (!showOc) query = query.eq("is_oc", false);
    if (!showSupplier) query = query.eq("supplier_delivery", false);
    if (locked) query = query.or(deliveredOrSoldBy(locked));
    if (term) query = query.or(["do_no", "customer_name", "address", "map_address"].map((c) => `${c}.ilike.%${term}%`).join(","));
    if (from) query = query.gte("delivery_date", from);
    if (to) query = query.lte("delivery_date", to);
    // A branch sees what it delivers (and DOs handed over to it); Cross-branch switches to what it sold that another branch delivers (view only).
    if (branch && crossOnly) query = query.eq("sales_branch", branch).neq("branch", branch);
    else if (branch) query = query.or(`branch.eq.${branch},helper_branch.eq.${branch}`);
    return query;
  };

  // Long ranges ("All dates") load the newest PAGE DOs; "Load more" adds the next PAGE.
  const limit = Math.min(Math.max(Number(sp.n) || PAGE, PAGE), MAX_LOADED);
  const [{ data, count }, { data: driverRows }, { data: sync }, { count: failedCount }, { data: trailerRows }] = await Promise.all([
    filtered(
      supabase
        .from("delivery_orders")
        .select(
          "*, driver:profiles!delivery_orders_driver_id_fkey(full_name, lorry_no), links:do_sales_orders(so_no, so_id), outstanding:do_outstanding(id, do_id, reason, todo, todo_other, description, created_at, cleared_at, creator:profiles!do_outstanding_created_by_fkey(full_name)), attempts:delivery_attempts(id, failed_at, failed_reason)",
          { count: "exact" }
        ),
      statuses,
      true
    )
      .is("outstanding.cleared_at", null) // only what's still outstanding; doesn't filter the DOs
      .order("delivery_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(0, limit - 1),
    supabase.from("profiles").select("id, full_name, lorry_no, branch").eq("role", "driver").order("full_name"),
    supabase.from("sync_status").select("synced_at").eq("source", "autocount").maybeSingle(),
    // Failed DOs are hidden from the other filters; their count goes on the Failed tab so none get missed.
    filtered(supabase.from("delivery_orders").select("id", { count: "exact", head: true }), ["failed"]),
    // Trailers: shared by every branch, offered under "Assign other branch" → Trailer.
    supabase.from("lorries").select("id, lorry_no, plate_no").eq("is_trailer", true),
  ]);
  const trailers = ((trailerRows ?? []) as Pick<Lorry, "id" | "lorry_no" | "plate_no">[])
    .sort((a, b) => a.lorry_no.localeCompare(b.lorry_no, undefined, { numeric: true }))
    .map((l) => ({ id: l.id, label: lorryLabel(l) }));
  // The trailer delivering a DO: one of ours, or an outsource trailer (no lorry in the app).
  const trailerOf = (j: Pick<DeliveryOrder, "trailer_id" | "outsource_trailer">) =>
    j.outsource_trailer
      ? { id: OUTSOURCE_TRAILER, label: "" }
      : j.trailer_id
        ? (trailers.find((x) => x.id === j.trailer_id) ?? { id: j.trailer_id, label: "?" })
        : null;
  // Newest were fetched first; cards still read oldest → newest.
  const jobs = await withStartedAt(supabase, ((data ?? []) as DeliveryOrder[]).reverse());
  const total = count ?? jobs.length;
  const capped = total > jobs.length;
  // Delivered count across everything matching, not just the loaded DOs.
  const done = capped
    ? ((await filtered(supabase.from("delivery_orders").select("id", { count: "exact", head: true })).eq("status", "delivered")).count ?? 0)
    : jobs.filter((j) => j.status === "delivered").length;
  const drivers = (driverRows ?? []) as Pick<Profile, "id" | "full_name" | "lorry_no" | "branch">[];
  // The delivering branch's drivers — only the other branch's once a DO is assigned to it; everyone when that branch has none set up.
  const driversFor = (j: Pick<DeliveryOrder, "branch" | "helper_branch">) => driversForBranch(drivers, j.helper_branch ?? j.branch);

  // O/C and Supplier delivery DOs get columns of their own (not Unassigned); O/C still to collect first, collected ones below.
  const columns = [
    ...statuses.map((s) => ({ key: s, label: t.status[s], dot: COLUMN_DOT[s], jobs: jobs.filter((j) => !j.is_oc && !j.supplier_delivery && j.status === s) })),
    ...(showOc
      ? [{ key: "oc", label: "O/C", dot: "bg-violet-500", jobs: jobs.filter((j) => j.is_oc).sort((a, b) => Number(a.status === "delivered") - Number(b.status === "delivered")) }]
      : []),
    ...(showSupplier ? [{ key: "supplier", label: T.supplierDelivery, dot: "bg-teal-500", jobs: jobs.filter((j) => j.supplier_delivery) }] : []),
  ];

  const isToday = from === today && to === today;
  const [weekFrom, weekTo] = weekRange(today);
  const isThisWeek = from === weekFrom && to === weekTo;
  const isAllDates = !from && !to;
  // Filters that stay on while staff change other ones.
  const keep = {
    show: show || undefined,
    extra: extra || undefined,
    xb: crossOnly ? "1" : undefined,
    branch: sp.branch,
  };
  const dateParams = isToday ? {} : { from, to };
  const hidden = (params: Record<string, string | undefined>) =>
    Object.entries(params).map(([k, v]) => v !== undefined && <input key={k} type="hidden" name={k} value={v} />);
  const rangeLabel = (term ? `${T.matching(term)} · ` : "") + (isToday
      ? T.todayOn(date(today))
      : isThisWeek
        ? T.thisWeekRange(date(weekFrom), date(weekTo))
        : isAllDates
          ? T.allDates
          : `${from ? date(from) : "…"} – ${to ? date(to) : "…"}`);
  const branchLabel =
    (!branch ? (locked ? t.branchesOf(locked.join(" + ")) : t.allBranches) : crossOnly ? T.crossOf(branch) : t.branchOf(branch)) + " · ";

  return (
    <PendingNav>
    <div className="space-y-4">
      {/* Only changes to this branch's DOs refresh the page (a DO search or All branches hears every change). */}
      <RealtimeRefresh
        table="delivery_orders"
        filter={!branch ? undefined : crossOnly ? `sales_branch=eq.${branch}` : `branch=eq.${branch}`}
      />
      {/* …and DOs handed over to this branch (live updates take one filter each). */}
      {branch && !crossOnly && <RealtimeRefresh table="delivery_orders" filter={`helper_branch=eq.${branch}`} />}
      {/* A sync that changed nothing still moves "synced … ago" forward. */}
      <RealtimeRefresh table="sync_status" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{T.title}</h1>
          <p className="text-sm text-slate-500">
            {branchLabel}{rangeLabel} · {t.doneOf(done, total.toLocaleString())}
            {sync && <> · <SyncAge syncedAt={sync.synced_at} /></>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {profile.role === "admin" && (
            <Link href="/deliveries/special/access" className="text-sm font-medium text-slate-500 hover:text-slate-900">{T.adminAccess}</Link>
          )}
          <Link href="/deliveries/new" className="btn-primary">{T.newSpecial}</Link>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-x-2.5 gap-y-2 p-2">
        <nav className={TAB_GROUP}>
          {(Object.keys(DELIVERY_FILTERS) as DeliveryFilter[]).map((value) => (
            <NavLink
              key={value}
              href={href({ ...keep, show: value || undefined, ...dateParams, q: q || undefined })}
              className={`${TAB} ${TAB_FILL} ${show === value ? TAB_ON : TAB_OFF}`}
            >
              {T.filters[value]}
              {value === "failed" && !!failedCount && (
                <span className="ml-1 rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">{failedCount}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Also show O/C / Supplier: looks like the tab groups beside it; dark once something extra is on. */}
        <span className="flex rounded-lg bg-slate-100 p-0.5">
          <span className="relative">
            <NavSelect
              aria-label={T.alsoShow}
              title={T.alsoShowTitle}
              value={extra}
              options={(Object.keys(EXTRAS) as Extra[]).map((value) => ({
                value,
                label: T.extras[value],
                href: href({ ...keep, extra: value || undefined, ...dateParams, q: q || undefined }),
              }))}
              className={`cursor-pointer appearance-none rounded-md py-1 pl-2 pr-6 text-xs font-medium shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-brand-600 ${
                extra ? "bg-slate-900 text-white" : "bg-white text-slate-900 hover:bg-slate-50"
              }`}
            />
            <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className={`pointer-events-none absolute right-1.5 top-1/2 size-3.5 -translate-y-1/2 ${extra ? "text-white" : "text-slate-400"}`}>
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
            </svg>
          </span>
        </span>

        {branch && (
          <NavLink
            href={href({ ...keep, xb: crossOnly ? undefined : "1", ...dateParams })}
            aria-pressed={crossOnly}
            title={T.crossTitle(branch)}
            className={`${TAB} border ${crossOnly ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-500 hover:text-slate-900"}`}
          >
            {T.crossBranch}
          </NavLink>
        )}

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <nav className={TAB_GROUP}>
            <NavLink href={href(keep)} className={`${TAB} ${TAB_FILL} ${isToday ? TAB_ON : TAB_OFF}`}>{t.today}</NavLink>
            <NavLink href={href({ ...keep, from: weekFrom, to: weekTo })} className={`${TAB} ${TAB_FILL} ${isThisWeek ? TAB_ON : TAB_OFF}`}>
              {T.thisWeek}
            </NavLink>
            <NavLink href={href({ ...keep, from: "", to: "" })} className={`${TAB} ${TAB_FILL} ${isAllDates ? TAB_ON : TAB_OFF}`}>
              {T.allDates}
            </NavLink>
          </nav>
          {/* Changing dates or branch starts a fresh look, so it drops any DO search. Both load as soon as they're picked. */}
          {(!locked || locked.length > 1) && (
            // Short labels keep the dropdown narrow, so the DO search fits on the same row.
            <NavSelect
              aria-label={T.branch}
              title={T.branchTitle}
              value={branch || "all"}
              options={[
                { value: "all", label: T.allShort, href: href({ ...keep, branch: "all", ...dateParams }) },
                ...BRANCHES.filter((b) => !locked || locked.includes(b.code)).map((b) => ({
                  value: b.code,
                  label: `${b.code}${!locked && userBranches(profile.branch).includes(b.code) ? " ★" : ""}`,
                  href: href({ ...keep, branch: b.code, ...dateParams }),
                })),
              ]}
              className="input w-auto px-2 py-1 text-xs"
            />
          )}
          <NavForm className="flex flex-wrap items-center gap-1.5">
            {hidden(keep)}
            <DateRangePicker key={`${from}|${to}`} from={from} to={to} today={today} small align="left" />
          </NavForm>
        </div>

        <NavForm className="flex w-full items-center gap-2 lg:ml-auto lg:w-auto">
          {hidden({ ...keep, ...(isToday ? {} : { from, to }) })}
          <label className="relative w-full lg:w-72">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input name="q" type="search" defaultValue={q} placeholder={t.searchDo} aria-label={t.searchDoLabel} className="input py-2 pl-9 pr-3 text-sm" />
          </label>
          {q && (
            <NavLink href={href({ ...keep, ...dateParams })} className="whitespace-nowrap text-sm text-brand-700 hover:underline">
              {t.clear}
            </NavLink>
          )}
        </NavForm>
        <PendingSpinner />
      </div>

      <PendingDim>
        {/* Phones: a tab per column, one column shown at a time. Tablets: swipe across. Laptops: side by side. */}
        <ColumnTabs
          columns={columns.map((c) => ({ key: c.key, label: c.label, dot: c.dot, count: c.jobs.length }))}
          className={`flex flex-col gap-3 pb-4 sm:-mx-4 sm:flex-row sm:snap-x sm:gap-4 sm:overflow-x-auto sm:px-4 lg:mx-0 lg:grid ${GRID_COLS[columns.length]} lg:overflow-visible lg:px-0`}
        >
          {columns.map(({ key, label, dot, jobs: col }) => {
            return (
              <section key={key} className="w-full shrink-0 snap-start rounded-2xl bg-slate-100/70 p-2 sm:w-72 lg:w-auto">
                <h2 className="flex items-center gap-2 px-2 py-2 text-sm font-semibold text-slate-700">
                  <span className={`size-2 rounded-full ${dot}`} />
                  {label}
                  <span className="ml-auto rounded-full bg-white px-2 text-xs font-medium text-slate-500">{col.length}</span>
                </h2>
                <div className="space-y-2">
                  {col.map((j) => {
                    // Only the delivering branch (or the branch it was handed over to) picks the driver and day; others just follow along.
                    const mine = canPlan(profile.branch, j.branch, j.helper_branch);
                    const plannable = mine && PLANNABLE.includes(j.status) && !j.voided_at && !j.office_cancelled_at;
                    const who = { ...profile, id: user.id };
                    const late = j.status !== "delivered" && j.delivery_date < today;
                    const open = j.outstanding ?? [];
                    // "Mark cancelled" (AutoCount cancelled it, the sync missed it): the DO's own branch or an admin, before it's on the road.
                    const canOfficeCancel = j.source === "autocount" && (profile.role === "admin" || canPlan(profile.branch, j.branch))
                      && (j.office_cancelled_at ? true : PLANNABLE.includes(j.status) && !j.cancelled);
                    return (
                      <article key={j.id} className={`card space-y-2 p-3 ${open.length ? "border-rose-500 ring-1 ring-rose-500" : ""} ${j.voided_at || j.office_cancelled_at ? "opacity-60" : ""}`}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                            <DoOutstanding doId={j.id} doNo={j.do_no} customer={j.customer_name} createdAt={j.created_at} docDate={j.doc_date} open={open} history={profile.role === "admin"} photo={!!j.pod_photo_path}
                              // Only the DO's own branch assigns it to (or takes it back from) another branch.
                              print={j.source === "special" && canPrintSpecial(j, who) ? { printed: j.print_count } : undefined}
                              // A DO delivered by a trailer can still be moved to another trailer or taken back here.
                              officeCancel={canOfficeCancel ? { reason: j.office_cancelled_at ? (j.office_cancel_reason ?? "") : null } : undefined}
                              handOver={(plannable || (mine && (j.trailer_id || j.outsource_trailer) && !j.voided_at)) && !j.is_oc && j.branch && canPlan(profile.branch, j.branch)
                                ? { branch: j.branch, helper: j.helper_branch, hasDriver: !!j.driver_id, trailer: trailerOf(j), trailers }
                                : undefined}
                            />
                          </span>
                          <span className="flex items-center gap-2">
                            {j.source === "special" && !j.special_no && canEditSpecial(j, who) && PLANNABLE.includes(j.status) ? (
                              <Link href={`/deliveries/special/${j.id}`} className="font-medium text-brand-700 hover:underline">{T.edit}</Link>
                            ) : j.source === "special" && (canPrintSpecial(j, who) || profile.role === "admin") ? (
                              <Link href={`/deliveries/special/${j.id}`} className="font-medium text-brand-700 hover:underline">{T.open}</Link>
                            ) : null}
                            <BranchTags job={j} />
                          </span>
                        </div>
                        {j.office_cancelled_at && (
                          <p className="-mt-1.5 text-xs text-rose-700">
                            <span className="mr-1 rounded bg-rose-600 px-1.5 font-bold text-white">{t.officeCancel.cancelled}</span>
                            {j.office_cancel_reason}
                          </p>
                        )}
                        {j.is_oc && <p className="-mt-1.5 text-xs font-medium text-violet-600">{T.ocCollects}</p>}
                        {(j.links?.length || j.so_no) && (
                          <p className="-mt-1.5 text-xs text-slate-400">{j.links?.length ? j.links.map((l) => l.so_no).join(", ") : j.so_no}</p>
                        )}
                        {j.special_no ? (
                          <p className="-mt-1.5 text-xs text-slate-400">{T.wasSpecial(j.special_no)}</p>
                        ) : j.source === "special" && (
                          <p className="-mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                            {j.voided_at && <span className="rounded bg-rose-600 px-1.5 font-bold text-white">VOID</span>}
                            Special{isSpecialReason(j.special_reason) && <span className="font-medium text-slate-600">· {SPECIAL_REASONS[j.special_reason]}</span>}
                            {j.print_count > 0 && <span>{T.printed}</span>}
                            {/* AutoCount was down: once it has the real DO, link it so syncs update this one. Goods SDOs aren't AutoCount DOs. */}
                            {!j.voided_at && !isGoodsReason(j.special_reason) && (j.created_by === user.id || profile.role === "admin" || mine) && <LinkSpecialDo doId={j.id} doNo={j.do_no} />}
                          </p>
                        )}
                        <p className="text-sm font-medium leading-snug">{j.customer_name}</p>
                        {mapAddress(j) && <p className="text-xs text-slate-500" title={j.map_address ? `AutoCount: ${j.address ?? t.noAddress}` : undefined}>{j.map_address && "📍 "}{mapAddress(j)}</p>}
                        {j.remarks && <p className="line-clamp-2 text-xs text-slate-500">📝 {j.remarks}</p>}
                        {j.instructions && <p className="line-clamp-2 text-xs text-slate-500">📋 {j.instructions}</p>}
                        {/* M- DOs: AutoCount sends no items for invoices, so the office types them. */}
                        {isIcbDo(j.do_no) && <ItemNote key={j.item_note ?? ""} doId={j.id} note={j.item_note ?? null} canEdit={canEditItemNote(j, profile)} />}
                        {!j.is_oc && (j.started_at || (j.status === "delivered" && j.delivered_at)) && (
                          <p className="text-xs font-medium text-slate-600">
                            ⏱ {j.started_at && T.out(fmtTime(j.started_at))}
                            {j.started_at && j.status === "delivered" && j.delivered_at && " · "}
                            {j.status === "delivered" && j.delivered_at && <span className="text-emerald-700">{T.deliveredAt(fmtTime(j.delivered_at))}</span>}
                          </p>
                        )}
                        {j.status === "failed" ? (
                          <p className="rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">
                            ❌ <span className="font-medium">{T.failed}</span> · {j.failed_reason || T.noReason}
                          </p>
                        ) : (
                          // Redelivered: earlier failed tries (they still earned their points).
                          j.attempts?.map((a) => (
                            <p key={a.id} className="text-xs text-slate-400">
                              {T.failedAt(fmtDateTime(a.failed_at))}{a.failed_reason && ` · ${a.failed_reason}`}
                            </p>
                          ))
                        )}
                        {open.map((o) => (
                          <p key={o.id} className="rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">
                            ⚠ <span className="font-medium">{todoText(o)}</span> · {o.reason}
                          </p>
                        ))}
                        {j.supplier_delivery ? (
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-teal-700">{T.supplierDelivery}</p>
                            {/* Picking a driver (or "Choose driver…") makes it our delivery again. */}
                            {mine && <AssignDriver key="supplier" doId={j.id} driverId={null} isSupplier drivers={driversFor(j)} />}
                          </div>
                        ) : j.is_oc && mine ? (
                          <div className="space-y-1.5">
                            <OcCollect key={`${j.status}-${j.delivered_at}`} doId={j.id} collectedAt={j.status === "delivered" ? (j.delivered_at ?? j.created_at) : null} />
                            {/* No delivery date for O/C; picking a driver makes it a delivery, and its card then has the date. */}
                            {plannable && (
                              <AssignDriver key={`${j.driver_id}-${j.is_oc}`} doId={j.id} driverId={j.driver_id} isOc={j.is_oc} drivers={driversFor(j)} driverName={j.driver ? driverLabel(j.driver) : undefined} />
                            )}
                          </div>
                        ) : j.is_oc ? (
                          <div className="space-y-0.5 text-xs text-slate-500">
                            <p>{j.status === "delivered" ? <span className="font-medium text-emerald-700">{T.collectedAt(j.delivered_at ? fmtDateTime(j.delivered_at) : "")}</span> : T.waitingCollect}</p>
                            <p className={late ? "text-rose-600" : ""}>📅 {date(j.delivery_date)}{late && T.late}</p>
                            <p className="text-slate-400">{T.handlesOc(branchName(j.branch), j.branch ?? "")}</p>
                          </div>
                        ) : plannable ? (
                          <div className="space-y-1.5">
                            {j.status === "failed" && <Redeliver doId={j.id} />}
                            <AssignDriver key={`${j.driver_id}-${j.is_oc}`} doId={j.id} driverId={j.driver_id} isOc={j.is_oc} drivers={driversFor(j)} driverName={j.driver ? driverLabel(j.driver) : undefined} />
                            <DoDate doId={j.id} date={j.delivery_date} today={today} />
                            {!j.is_oc && <DoTimeSlot doId={j.id} slot={j.time_slot} />}
                          </div>
                        ) : (
                          <div className="space-y-0.5 text-xs text-slate-500">
                            <p>{j.outsource_trailer ? `🚛 ${T.byOutsource}` : j.trailer_id ? `🚛 ${T.byTrailer(trailerOf(j)!.label)}` : <>🚚 {j.driver ? driverLabel(j.driver) : j.is_oc ? T.ocCollects : T.noDriver}</>}</p>
                            <p className={late ? "text-rose-600" : ""}>📅 {date(j.delivery_date)}{late && T.late}</p>
                            {j.time_slot && <p>🕒 {t.estimated(TIME_SLOTS[j.time_slot])}</p>}
                            {!mine && (
                              <p className="text-slate-400">
                                {T.deliveringBy(branchName(j.branch), j.branch ?? "")}{j.helper_branch && T.helperDelivers(branchName(j.helper_branch))}
                              </p>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                  {col.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-400">{T.nothingHere}</p>}
                </div>
              </section>
            );
          })}
        </ColumnTabs>

      {capped && (
        <p className="pb-4 text-center text-sm text-slate-500">
          {T.showingNewest(jobs.length.toLocaleString(), total.toLocaleString())}
          {limit < MAX_LOADED ? (
            <>
              {" · "}
              <NavLink
                href={href({ ...keep, ...dateParams, q: q || undefined, n: String(limit + PAGE) })}
                scroll={false}
                className="font-medium text-brand-700 hover:underline"
              >
                {T.loadMore(Math.min(PAGE, total - jobs.length))}
              </NavLink>
            </>
          ) : (
            T.narrowDates
          )}
        </p>
      )}
      </PendingDim>
    </div>
    </PendingNav>
  );
}
