import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { addDays, fmtDate, fmtDateTime } from "@/lib/format";
import { BRANCHES, deliveredOrSoldBy, lockedBranches, pageBranch, userBranches } from "@/lib/branches";
import { todoLabel, type DeliveryOrder, type Outstanding } from "@/lib/types";
import { BranchTags } from "@/components/DocLinks";
import { ClearButton } from "@/components/Outstanding";

const SHOW = { "": "Not cleared", cleared: "Cleared", all: "All" } as const;
type Show = keyof typeof SHOW;

const TAB = "rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap";
const TAB_ON = "bg-white text-slate-900 shadow-sm";
const TAB_OFF = "text-slate-500 hover:text-slate-900";

type Row = Outstanding & { delivery: Pick<DeliveryOrder, "do_no" | "customer_name" | "delivery_date" | "branch" | "sales_branch"> };

function href(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return qs ? `/outstanding?${qs}` : "/outstanding";
}

export default async function OutstandingPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; from?: string; to?: string; branch?: string }>;
}) {
  const sp = await searchParams;
  const show: Show = sp.show && sp.show in SHOW ? (sp.show as Show) : "";
  const from = sp.from ?? "";
  const to = sp.to && (!from || sp.to >= from) ? sp.to : "";
  const { supabase, profile } = await requireStaff();
  // Dispatchers only see their own branches (DOs they deliver or sold).
  const locked = lockedBranches(profile);
  const pickedBranch = pageBranch(sp.branch, profile);
  const branch = BRANCHES.some((b) => b.code === pickedBranch) ? pickedBranch : "";

  let query = supabase
    .from("do_outstanding")
    .select(
      "*, delivery:delivery_orders!inner(do_no, customer_name, delivery_date, branch, sales_branch), creator:profiles!do_outstanding_created_by_fkey(full_name), clearer:profiles!do_outstanding_cleared_by_fkey(full_name)"
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (show === "") query = query.is("cleared_at", null);
  if (show === "cleared") query = query.not("cleared_at", "is", null);
  // Dates are the day the remark was added (Malaysia time).
  if (from) query = query.gte("created_at", `${from}T00:00:00+08:00`);
  if (to) query = query.lt("created_at", `${addDays(to, 1)}T00:00:00+08:00`);
  if (branch || locked) query = query.or(deliveredOrSoldBy(branch || locked!), { referencedTable: "delivery" });
  const { data, error } = await query;
  if (error) console.error("Loading outstanding failed:", error.message);

  // Not cleared first, then newest.
  const rows = ((data ?? []) as Row[]).sort((a, b) => Number(!!a.cleared_at) - Number(!!b.cleared_at));
  const openCount = rows.filter((r) => !r.cleared_at).length;
  const keep = { show: show || undefined, branch: sp.branch, from: from || undefined, to: to || undefined };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Outstanding</h1>
        <p className="text-sm text-slate-500">
          {branch ? `${branch} branch · ` : locked ? `${locked.join(" + ")} branches · ` : "All branches · "}
          {from || to ? `Added ${from ? fmtDate(from) : "…"} – ${to ? fmtDate(to) : "…"}` : "All dates"} · {openCount} not cleared
        </p>
      </div>

      <div className="card flex flex-wrap items-center gap-x-2.5 gap-y-2 p-2">
        <nav className="flex rounded-lg bg-slate-100 p-0.5">
          {(Object.keys(SHOW) as Show[]).map((value) => (
            <Link key={value} href={href({ ...keep, show: value || undefined })} className={`${TAB} ${show === value ? TAB_ON : TAB_OFF}`}>
              {SHOW[value]}
            </Link>
          ))}
        </nav>
        <form className="flex flex-wrap items-center gap-1.5">
          {show && <input type="hidden" name="show" value={show} />}
          {(!locked || locked.length > 1) && (
            <select name="branch" defaultValue={branch || "all"} aria-label="Branch" className="input w-auto px-2 py-1 text-xs">
              <option value="all">{locked ? "All my branches" : "All branches"}</option>
              {BRANCHES.filter((b) => !locked || locked.includes(b.code)).map((b) => (
                <option key={b.code} value={b.code}>
                  {b.code}{!locked && userBranches(profile.branch).includes(b.code) ? " (mine)" : ""}
                </option>
              ))}
            </select>
          )}
          <input type="date" name="from" defaultValue={from} aria-label="From" className="input w-auto px-2 py-1 text-xs" />
          <span className="text-slate-400">–</span>
          <input type="date" name="to" defaultValue={to} aria-label="To" className="input w-auto px-2 py-1 text-xs" />
          <button className="btn-secondary px-2.5 py-1 text-xs">Go</button>
          {(from || to) && (
            <Link href={href({ ...keep, from: undefined, to: undefined })} className="text-xs text-brand-700 hover:underline">
              All dates
            </Link>
          )}
        </form>
      </div>

      {error && <p className="text-sm text-rose-600">Couldn&apos;t load outstanding DOs. Has the database been upgraded (supabase/upgrade.sql)?</p>}
      {!error && rows.length === 0 && <p className="py-10 text-center text-sm text-slate-400">Nothing outstanding here 🎉</p>}

      <ul className="space-y-2">
        {rows.map((r) => {
          const cleared = !!r.cleared_at;
          return (
            <li
              key={r.id}
              className={`card flex flex-wrap items-start justify-between gap-3 p-4 ${cleared ? "bg-slate-100 text-slate-400" : ""}`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`text-sm font-semibold ${cleared ? "" : "text-slate-900"}`}>{r.delivery.do_no}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${cleared ? "bg-slate-200 text-slate-500" : "bg-rose-50 text-rose-700"}`}
                  >
                    {todoLabel(r)}
                  </span>
                  {!cleared && <BranchTags job={r.delivery} />}
                </div>
                <p className={`text-sm ${cleared ? "" : "font-medium text-slate-800"}`}>{r.reason}</p>
                {r.description && <p className={`text-sm ${cleared ? "" : "text-slate-600"}`}>{r.description}</p>}
                <p className="text-xs text-slate-400">
                  {r.delivery.customer_name} · DO date {fmtDate(r.delivery.delivery_date)} · Added {fmtDateTime(r.created_at)}
                  {r.creator?.full_name && ` by ${r.creator.full_name}`}
                </p>
              </div>
              {cleared ? (
                <p className="text-right text-xs">
                  <span className="font-medium">Cleared</span>
                  <br />
                  {fmtDateTime(r.cleared_at!)}
                  {r.clearer?.full_name && ` · ${r.clearer.full_name}`}
                </p>
              ) : (
                <ClearButton id={r.id} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
