import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { SoBadge, DoBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/format";
import { branchName, lockedBranches } from "@/lib/branches";
import type { DoStatus, SoStatus } from "@/lib/types";

const TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "partial", label: "Partial" },
  { value: "fulfilled", label: "Fully on DO" },
];

type Row = {
  id: string;
  so_no: string;
  so_date: string;
  customer_name: string;
  address: string | null;
  branch: string | null;
  status: SoStatus;
  links: { delivery_orders: { do_no: string; status: DoStatus; cancelled: boolean } | null }[];
};

/** Builds "/orders?…" from the filters, dropping empty ones ("All" must not fall back to the current URL). */
function ordersHref(params: Record<string, string>) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return qs ? `/orders?${qs}` : "/orders";
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; loc?: string; status?: string; from?: string; to?: string }>;
}) {
  const { q = "", loc = "", status = "", from = "", to: rawTo = "" } = await searchParams;
  const to = rawTo && (!from || rawTo >= from) ? rawTo : "";
  const { supabase, profile } = await requireStaff();
  // Dispatchers only see their own branches' SOs.
  const locked = lockedBranches(profile);

  let query = supabase
    .from("sales_orders")
    .select("id, so_no, so_date, customer_name, address, branch, status, links:do_sales_orders(delivery_orders(do_no, status, cancelled))")
    .order("so_date", { ascending: false })
    .order("so_no", { ascending: false })
    .limit(200);
  const term = q.replace(/[,()%]/g, " ").trim();
  if (term) query = query.or(`so_no.ilike.%${term}%,customer_name.ilike.%${term}%,transfer_to.ilike.%${term}%`);
  const locTerm = loc.replace(/[,()%]/g, " ").trim();
  if (locTerm) query = query.or(`address.ilike.%${locTerm}%,branch.ilike.%${locTerm}%`);
  if (locked) query = query.in("branch", locked);
  if (status) query = query.eq("status", status);
  if (from) query = query.gte("so_date", from);
  if (to) query = query.lte("so_date", to);
  const { data } = await query;
  const orders = (data ?? []) as unknown as Row[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales orders</h1>
          <p className="text-sm text-slate-500">Imported from AutoCount, with the DOs they were transferred to.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl bg-slate-100 p-1">
          {TABS.map((t) => (
            <Link
              key={t.value}
              href={ordersHref({ q, loc, status: t.value, from, to })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                status === t.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <form className="flex min-w-56 flex-1 flex-wrap items-center gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <input name="q" defaultValue={q} placeholder="Search SO no., DO no. or customer…" className="input min-w-48 flex-1" />
          <input name="loc" defaultValue={loc} placeholder="Search location…" className="input min-w-40 flex-1" />
          <label className="flex items-center gap-1.5 text-sm text-slate-500">
            From <input type="date" name="from" defaultValue={from} className="input w-auto" />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-500">
            To <input type="date" name="to" defaultValue={to} className="input w-auto" />
          </label>
          <button className="btn-secondary">Go</button>
          {(q || loc || from || to) && (
            <Link href={ordersHref({ status })} className="text-sm text-brand-700 hover:underline">Clear</Link>
          )}
        </form>
      </div>

      <div className="card overflow-hidden">
        {orders.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">
            {q || loc || status || from || to ? (
              "No sales orders match these filters."
            ) : (
              "No sales orders yet."
            )}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3">SO no.</th>
                <th className="px-4 py-3">Customer</th>
                <th className="hidden px-4 py-3 md:table-cell">Location</th>
                <th className="hidden px-4 py-3 md:table-cell">Date</th>
                <th className="hidden px-4 py-3 lg:table-cell">Branch</th>
                <th className="px-4 py-3">Status</th>
                <th className="hidden px-4 py-3 sm:table-cell">Deliveries</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => (
                <tr key={o.id} className="group hover:bg-slate-50/80">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/orders/${o.id}`} className="text-brand-700 group-hover:underline">{o.so_no}</Link>
                  </td>
                  <td className="px-4 py-3">{o.customer_name}</td>
                  <td className="hidden max-w-64 px-4 py-3 text-slate-500 md:table-cell">
                    <span className="line-clamp-2">{o.address ?? "—"}</span>
                  </td>
                  <td className="hidden px-4 py-3 text-slate-500 md:table-cell">{fmtDate(o.so_date)}</td>
                  <td className="hidden px-4 py-3 text-slate-500 lg:table-cell" title={branchName(o.branch)}>{o.branch ?? "—"}</td>
                  <td className="px-4 py-3"><SoBadge status={o.status} /></td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {o.links.length === 0 ? <span className="text-slate-400">—</span> :
                        o.links.map((l) => l.delivery_orders).filter((d) => !!d).map((d) => (
                          <span key={d.do_no} title={d.do_no} className={d.cancelled ? "line-through opacity-50" : ""}>
                            <DoBadge status={d.status} />
                          </span>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
