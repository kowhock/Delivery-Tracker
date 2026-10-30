import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { driverLabel, fmtDate, fmtDateTime, fmtTime, mapAddress, todayMY, weekRange } from "@/lib/format";
import { withStartedAt } from "@/lib/delivery-times";
import { BRANCHES, branchName, canPlan, deliveredOrSoldBy, driversForBranch, lockedBranches, pageBranch, userBranches } from "@/lib/branches";
import { DO_STATUSES, DO_STATUS_LABEL, TIME_SLOTS, todoLabel, type DeliveryOrder, type DoStatus, type Profile } from "@/lib/types";
import { AssignDriver } from "@/components/AssignDriver";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { SyncAge } from "@/components/SyncAge";
import { BranchTags } from "@/components/DocLinks";
import { DoDate, DoTimeSlot } from "@/components/MoveDate";
import { DoOutstanding } from "@/components/Outstanding";
import { OcCollect } from "@/components/OcCollect";
import { Redeliver } from "@/components/Redeliver";
import { LinkSpecialDo } from "@/components/LinkSpecialDo";
import { NavForm, NavLink, NavSelect, PendingDim, PendingNav, PendingSpinner } from "@/components/PendingNav";

const COLUMN_DOT: Record<DoStatus, string> = {
  pending: "bg-slate-400",
  assigned: "bg-sky-500",
  out_for_delivery: "bg-amber-500",
  delivered: "bg-emerald-500",
  failed: "bg-rose-500",
};

// Failed DOs only show under their own filter, so the other columns get the room.
const DELIVERY_FILTERS = {
  "": { label: "All", statuses: DO_STATUSES.filter((s) => s !== "failed") },
  undelivered: { label: "Not delivered", statuses: DO_STATUSES.filter((s) => s !== "delivered" && s !== "failed") },
  delivered: { label: "Delivered", statuses: ["delivered"] as DoStatus[] },
  failed: { label: "Failed", statuses: ["failed"] as DoStatus[] },
};
type DeliveryFilter = keyof typeof DELIVERY_FILTERS;

// "Also show": DOs our drivers don't deliver, hidden unless picked.
const EXTRAS = { "": "Deliveries", oc: "+ O/C", supplier: "+ Supplier" };
type Extra = keyof typeof EXTRAS;

const PAGE = 300; // DOs loaded at a time
const MAX_LOADED = 3000;

const PLANNABLE: DoStatus[] = ["pending", "assigned", "failed"];


const GRID_COLS = ["", "lg:grid-cols-1", "lg:grid-cols-2", "lg:grid-cols-3", "lg:grid-cols-4", "lg:grid-cols-5", "lg:grid-cols-6"];

const TAB = "rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap";
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
  const statuses = DELIVERY_FILTERS[show].statuses;
  // O/C (customer collects) and Supplier delivery are hidden unless staff pick them under "Also show".
  // (?oc=show is the old link for O/C.)
  const extra: Extra = sp.extra && sp.extra in EXTRAS ? (sp.extra as Extra) : sp.oc === "show" ? "oc" : "";
  const showOc = extra === "oc";
  const showSupplier = extra === "supplier";
  // Cross-branch: DOs this branch sold that another branch is delivering.
  const crossOnly = sp.xb === "1";
  const q = (sp.q ?? "").trim();
  const term = q.replace(/[,()%*]/g, " ").trim();
  const { supabase, user, profile } = await requireStaff();
  // Opens on the user's own branch, like Driver status. Dispatchers can't switch away from theirs.
  const locked = lockedBranches(profile);
  const pickedBranch = pageBranch(sp.branch, profile);
  const branch = BRANCHES.some((b) => b.code === pickedBranch) ? pickedBranch : "";

  // No dates picked = every delivery; otherwise only deliveries dated inside the range.
  // Searching a DO number looks across all dates (and branches, unless the user is kept to one) —
  // it's usually an older DO someone is asking about.
  // The page's filters, used for the cards and for the delivered count.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filtered = <Q extends Record<"eq" | "in" | "or" | "ilike" | "gte" | "lte" | "neq", any>>(query: Q, st: DoStatus[] = statuses): Q => {
    query = query.eq("cancelled", false).in("status", st);
    if (!showOc) query = query.eq("is_oc", false);
    if (!showSupplier) query = query.eq("supplier_delivery", false);
    if (locked) query = query.or(deliveredOrSoldBy(locked));
    if (term) query = query.ilike("do_no", `%${term}%`);
    else {
      if (from) query = query.gte("delivery_date", from);
      if (to) query = query.lte("delivery_date", to);
      // A branch sees what it delivers (and DOs handed over to it); Cross-branch switches to what it sold that another branch delivers (view only).
      if (branch && crossOnly) query = query.eq("sales_branch", branch).neq("branch", branch);
      else if (branch) query = query.or(`branch.eq.${branch},helper_branch.eq.${branch}`);
    }
    return query;
  };

  // Long ranges ("All dates") load the newest PAGE DOs; "Load more" adds the next PAGE.
  const limit = Math.min(Math.max(Number(sp.n) || PAGE, PAGE), MAX_LOADED);
  const [{ data, count }, { data: driverRows }, { data: sync }, { count: failedCount }] = await Promise.all([
    filtered(
      supabase
        .from("delivery_orders")
        .select(
          "*, driver:profiles!delivery_orders_driver_id_fkey(full_name, lorry_no), links:do_sales_orders(so_no, so_id), outstanding:do_outstanding(id, do_id, reason, todo, todo_other, description, created_at, cleared_at, creator:profiles!do_outstanding_created_by_fkey(full_name)), attempts:delivery_attempts(id, failed_at, failed_reason)",
          { count: "exact" }
        )
    )
      .is("outstanding.cleared_at", null) // only what's still outstanding; doesn't filter the DOs
      .order("delivery_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(0, limit - 1),
    supabase.from("profiles").select("id, full_name, lorry_no, branch").eq("role", "driver").order("full_name"),
    supabase.from("sync_status").select("synced_at").eq("source", "autocount").maybeSingle(),
    // Failed DOs are hidden from the other filters; their count goes on the Failed tab so none get missed.
    filtered(supabase.from("delivery_orders").select("id", { count: "exact", head: true }), ["failed"]),
  ]);
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
    ...statuses.map((s) => ({ key: s, label: DO_STATUS_LABEL[s], dot: COLUMN_DOT[s], jobs: jobs.filter((j) => !j.is_oc && !j.supplier_delivery && j.status === s) })),
    ...(showOc
      ? [{ key: "oc", label: "O/C", dot: "bg-violet-500", jobs: jobs.filter((j) => j.is_oc).sort((a, b) => Number(a.status === "delivered") - Number(b.status === "delivered")) }]
      : []),
    ...(showSupplier ? [{ key: "supplier", label: "Supplier delivery", dot: "bg-teal-500", jobs: jobs.filter((j) => j.supplier_delivery) }] : []),
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
  const rangeLabel = term
    ? `DO no. matching "${term}" · all dates`
    : isToday
      ? `Today, ${fmtDate(today)}`
      : isThisWeek
        ? `This week, ${fmtDate(weekFrom)} – ${fmtDate(weekTo)}`
        : isAllDates
          ? "All dates"
          : `${from ? fmtDate(from) : "…"} – ${to ? fmtDate(to) : "…"}`;
  const branchLabel =
    term && !locked ? "" : !branch ? (locked ? `${locked.join(" + ")} branches · ` : "All branches · ") : crossOnly ? `${branch} cross-branch (delivered by other branches) · ` : `${branch} branch · `;

  return (
    <PendingNav>
    <div className="space-y-4">
      {/* Only changes to this branch's DOs refresh the page (a DO search or All branches hears every change). */}
      <RealtimeRefresh
        table="delivery_orders"
        filter={term || !branch ? undefined : crossOnly ? `sales_branch=eq.${branch}` : `branch=eq.${branch}`}
      />
      {/* …and DOs handed over to this branch (live updates take one filter each). */}
      {!term && branch && !crossOnly && <RealtimeRefresh table="delivery_orders" filter={`helper_branch=eq.${branch}`} />}
      {/* A sync that changed nothing still moves "synced … ago" forward. */}
      <RealtimeRefresh table="sync_status" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Deliveries</h1>
          <p className="text-sm text-slate-500">
            {branchLabel}{rangeLabel} · {done} of {total.toLocaleString()} delivered
            {sync && <> · <SyncAge syncedAt={sync.synced_at} /></>}
          </p>
        </div>
        <Link href="/deliveries/new" className="btn-primary">+ Special DO</Link>
      </div>

      <div className="card flex flex-wrap items-center gap-x-2.5 gap-y-2 p-2">
        <nav className="flex rounded-lg bg-slate-100 p-0.5">
          {(Object.keys(DELIVERY_FILTERS) as DeliveryFilter[]).map((value) => (
            <NavLink
              key={value}
              href={href({ ...keep, show: value || undefined, ...dateParams, q: q || undefined })}
              className={`${TAB} ${show === value ? TAB_ON : TAB_OFF}`}
            >
              {DELIVERY_FILTERS[value].label}
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
              aria-label="Also show"
              title="Also show O/C and Supplier delivery DOs"
              value={extra}
              options={(Object.keys(EXTRAS) as Extra[]).map((value) => ({
                value,
                label: EXTRAS[value],
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
            title={`DOs ${branch} sold that another branch is delivering`}
            className={`${TAB} border ${crossOnly ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-500 hover:text-slate-900"} ${term ? "opacity-50" : ""}`}
          >
            Cross-branch
          </NavLink>
        )}

        <div className={`flex flex-wrap items-center gap-2 ${term ? "opacity-50" : ""}`}>
          <nav className="flex rounded-lg bg-slate-100 p-0.5">
            <NavLink href={href(keep)} className={`${TAB} ${isToday && !term ? TAB_ON : TAB_OFF}`}>Today</NavLink>
            <NavLink href={href({ ...keep, from: weekFrom, to: weekTo })} className={`${TAB} ${isThisWeek && !term ? TAB_ON : TAB_OFF}`}>
              This week
            </NavLink>
            <NavLink href={href({ ...keep, from: "", to: "" })} className={`${TAB} ${isAllDates && !term ? TAB_ON : TAB_OFF}`}>
              All dates
            </NavLink>
          </nav>
          {/* Changing dates or branch starts a fresh look, so it drops any DO search. */}
          <NavForm className="flex flex-wrap items-center gap-1.5">
            {hidden({ ...keep, branch: undefined })}
            {(!locked || locked.length > 1) && (
              // Short labels keep the dropdown narrow, so the DO search fits on the same row.
              <select name="branch" defaultValue={branch || "all"} aria-label="Branch" title="Branch (★ = mine)" className="input w-auto px-2 py-1 text-xs">
                <option value="all">{locked ? "All" : "All"}</option>
                {BRANCHES.filter((b) => !locked || locked.includes(b.code)).map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.code}{!locked && userBranches(profile.branch).includes(b.code) ? " ★" : ""}
                  </option>
                ))}
              </select>
            )}
            <input type="date" name="from" defaultValue={from} aria-label="From" className="input w-auto px-2 py-1 text-xs" />
            <span className="text-slate-400">–</span>
            <input type="date" name="to" defaultValue={to} aria-label="To" className="input w-auto px-2 py-1 text-xs" />
            <button className="btn-secondary px-2.5 py-1 text-xs">Go</button>
          </NavForm>
        </div>

        <NavForm className="flex w-full items-center gap-2 lg:ml-auto lg:w-auto">
          {hidden({ ...keep, ...(isToday ? {} : { from, to }) })}
          <input name="q" defaultValue={q} placeholder="🔍 Search DO no." className="input px-2 py-1 text-xs lg:w-40" />
          {q && (
            <NavLink href={href({ ...keep, ...dateParams })} className="whitespace-nowrap text-xs text-brand-700 hover:underline">
              Clear
            </NavLink>
          )}
        </NavForm>
        <PendingSpinner />
      </div>

      <PendingDim>
        <div className={`-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 lg:mx-0 lg:grid ${GRID_COLS[columns.length]} lg:overflow-visible lg:px-0`}>
          {columns.map(({ key, label, dot, jobs: col }) => {
            return (
              <section key={key} className="w-72 shrink-0 snap-start rounded-2xl bg-slate-100/70 p-2 lg:w-auto">
                <h2 className="flex items-center gap-2 px-2 py-2 text-sm font-semibold text-slate-700">
                  <span className={`size-2 rounded-full ${dot}`} />
                  {label}
                  <span className="ml-auto rounded-full bg-white px-2 text-xs font-medium text-slate-500">{col.length}</span>
                </h2>
                <div className="space-y-2">
                  {col.map((j) => {
                    // Only the delivering branch (or the branch it was handed over to) picks the driver and day; others just follow along.
                    const mine = canPlan(profile.branch, j.branch, j.helper_branch);
                    const plannable = mine && PLANNABLE.includes(j.status);
                    const late = j.status !== "delivered" && j.delivery_date < today;
                    const open = j.outstanding ?? [];
                    return (
                      <article key={j.id} className={`card space-y-2 p-3 ${open.length ? "border-rose-500 ring-1 ring-rose-500" : ""}`}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                            <DoOutstanding doId={j.id} doNo={j.do_no} customer={j.customer_name} createdAt={j.created_at} docDate={j.doc_date} open={open} history={profile.role === "admin"} photo={!!j.pod_photo_path}
                              // Only the DO's own branch assigns it to (or takes it back from) another branch.
                              handOver={plannable && !j.is_oc && j.branch && canPlan(profile.branch, j.branch) ? { branch: j.branch, helper: j.helper_branch, hasDriver: !!j.driver_id } : undefined}
                            />
                          </span>
                          <span className="flex items-center gap-2">
                            {j.source === "special" && !j.special_no && (j.created_by === user.id || profile.role === "admin") && PLANNABLE.includes(j.status) && (
                              <Link href={`/deliveries/special/${j.id}`} className="font-medium text-brand-700 hover:underline">Edit</Link>
                            )}
                            <BranchTags job={j} />
                          </span>
                        </div>
                        {j.is_oc && <p className="-mt-1.5 text-xs font-medium text-violet-600">O/C (customer collects)</p>}
                        {(j.links?.length || j.so_no) && (
                          <p className="-mt-1.5 text-xs text-slate-400">{j.links?.length ? j.links.map((l) => l.so_no).join(", ") : j.so_no}</p>
                        )}
                        {j.special_no ? (
                          <p className="-mt-1.5 text-xs text-slate-400">🔗 Was special DO {j.special_no}</p>
                        ) : j.source === "special" && (
                          <p className="-mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                            Special
                            {/* AutoCount was down: once it has the real DO, link it so syncs update this one. */}
                            {(j.created_by === user.id || profile.role === "admin" || mine) && <LinkSpecialDo doId={j.id} doNo={j.do_no} />}
                          </p>
                        )}
                        <p className="text-sm font-medium leading-snug">{j.customer_name}</p>
                        {mapAddress(j) && <p className="text-xs text-slate-500" title={j.map_address ? `AutoCount: ${j.address ?? "no address"}` : undefined}>{j.map_address && "📍 "}{mapAddress(j)}</p>}
                        {j.remarks && <p className="line-clamp-2 text-xs text-slate-500">📝 {j.remarks}</p>}
                        {j.instructions && <p className="line-clamp-2 text-xs text-slate-500">📋 {j.instructions}</p>}
                        {!j.is_oc && (j.started_at || (j.status === "delivered" && j.delivered_at)) && (
                          <p className="text-xs font-medium text-slate-600">
                            ⏱ {j.started_at && `Out ${fmtTime(j.started_at)}`}
                            {j.started_at && j.status === "delivered" && j.delivered_at && " · "}
                            {j.status === "delivered" && j.delivered_at && <span className="text-emerald-700">Delivered {fmtTime(j.delivered_at)}</span>}
                          </p>
                        )}
                        {j.status === "failed" ? (
                          <p className="rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">
                            ❌ <span className="font-medium">Failed</span> · {j.failed_reason || "no reason given"}
                          </p>
                        ) : (
                          // Redelivered: earlier failed tries (they still earned their points).
                          j.attempts?.map((a) => (
                            <p key={a.id} className="text-xs text-slate-400">
                              ↻ Failed {fmtDateTime(a.failed_at)}{a.failed_reason && ` · ${a.failed_reason}`}
                            </p>
                          ))
                        )}
                        {open.map((o) => (
                          <p key={o.id} className="rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">
                            ⚠ <span className="font-medium">{todoLabel(o)}</span> · {o.reason}
                          </p>
                        ))}
                        {j.supplier_delivery ? (
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-teal-700">Supplier delivery</p>
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
                            <p>{j.status === "delivered" ? <span className="font-medium text-emerald-700">✅ Collected {j.delivered_at && fmtDateTime(j.delivered_at)}</span> : "🏬 Waiting for customer to collect"}</p>
                            <p className={late ? "text-rose-600" : ""}>📅 {fmtDate(j.delivery_date)}{late && " · late"}</p>
                            <p className="text-slate-400">{branchName(j.branch)} ({j.branch}) handles this O/C</p>
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
                            <p>🚚 {j.driver ? driverLabel(j.driver) : j.is_oc ? "O/C (customer collects)" : "No driver yet"}</p>
                            <p className={late ? "text-rose-600" : ""}>📅 {fmtDate(j.delivery_date)}{late && " · late"}</p>
                            {j.time_slot && <p>🕒 Estimated {TIME_SLOTS[j.time_slot]}</p>}
                            {!mine && (
                              <p className="text-slate-400">
                                {branchName(j.branch)} ({j.branch}) is delivering this DO{j.helper_branch && ` · ${branchName(j.helper_branch)} delivers`}
                              </p>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                  {col.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-400">Nothing here</p>}
                </div>
              </section>
            );
          })}
        </div>

      {capped && (
        <p className="pb-4 text-center text-sm text-slate-500">
          Showing newest {jobs.length.toLocaleString()} of {total.toLocaleString()} DOs
          {limit < MAX_LOADED ? (
            <>
              {" · "}
              <NavLink
                href={href({ ...keep, ...dateParams, q: q || undefined, n: String(limit + PAGE) })}
                scroll={false}
                className="font-medium text-brand-700 hover:underline"
              >
                Load {Math.min(PAGE, total - jobs.length)} more
              </NavLink>
            </>
          ) : (
            " · narrow the dates to see older ones"
          )}
        </p>
      )}
      </PendingDim>
    </div>
    </PendingNav>
  );
}
