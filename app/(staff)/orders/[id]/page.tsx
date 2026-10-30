import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { resendDeliveredNotice } from "@/app/actions";
import { waApiEnabled } from "@/lib/whatsapp-api";
import { branchName, lockedBranches } from "@/lib/branches";
import { splitDocNos } from "@/lib/autocount-rows";
import { DoBadge, SoBadge } from "@/components/StatusBadge";
import { driverLabel, fmtDate, fmtDateTime, fmtMoney, fmtQty } from "@/lib/format";
import { EVENT_LABEL, TIME_SLOTS, type DeliveryOrder, type DoStatus, type TimeSlot, type SalesOrder, type StatusEvent } from "@/lib/types";
import { podPhotoUrls } from "@/lib/pod";

type Item = { id: string; item_code: string; description: string | null; uom: string | null; qty: number };

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireStaff();

  const [{ data: so }, { data: items }, { data: linkRows }] = await Promise.all([
    supabase.from("sales_orders").select("*").eq("id", id).single<SalesOrder>(),
    supabase.from("so_items").select("id, item_code, description, uom, qty").eq("so_id", id).order("line_no"),
    supabase.from("do_sales_orders").select("do_id").eq("so_id", id),
  ]);
  if (!so) notFound();

  // One SO can be split over several DOs; each DO may also carry other SOs of the same debtor.
  const doIds = (linkRows ?? []).map((l) => l.do_id as string);
  const [{ data: dos }, { data: events }] = await Promise.all([
    doIds.length
      ? supabase
          .from("delivery_orders")
          .select("*, driver:profiles!delivery_orders_driver_id_fkey(full_name, lorry_no), do_items(id, item_code, description, uom, qty), links:do_sales_orders(so_no, so_id)")
          .in("id", doIds)
          .order("do_no")
      : Promise.resolve({ data: [] }),
    supabase
      .from("status_events")
      .select("id, status, note, created_at, do_id, actor:profiles!status_events_actor_id_fkey(full_name)")
      .or(doIds.length ? `so_id.eq.${id},do_id.in.(${doIds.join(",")})` : `so_id.eq.${id}`)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const lines = (items ?? []) as Item[];
  const deliveries = (dos ?? []) as DeliveryOrder[];
  // Dispatchers: their branches' SOs, or SOs with a DO their branches deliver or sold.
  const locked = lockedBranches(profile);
  const theirs = (b: string | null) => !!b && !!locked?.includes(b);
  if (locked && !theirs(so.branch) && !deliveries.some((d) => theirs(d.branch) || theirs(d.sales_branch))) notFound();
  const doNoById = new Map(deliveries.map((d) => [d.id, d.do_no]));
  const timeline = (events ?? []) as unknown as StatusEvent[];
  // DOs AutoCount says this SO went to, but whose DO file hasn't been imported yet.
  const notImported = splitDocNos(so.transfer_to).filter((no) => !deliveries.some((d) => d.do_no === no));

  // Signed links (valid 1 hour) for proof-of-delivery photos
  const photoUrls: Record<string, string[]> = {};
  await Promise.all(
    deliveries.filter((d) => d.pod_photo_path).map(async (d) => (photoUrls[d.id] = await podPhotoUrls(supabase, d.id, d.pod_photo_path)))
  );

  return (
    <div className="space-y-6">
      <Link href="/orders" className="text-sm text-slate-500 hover:text-slate-900">← Sales orders</Link>

      {/* Header */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{so.so_no}</h1>
              <SoBadge status={so.status} />
            </div>
            <p className="mt-1 text-slate-600">{so.customer_name}{so.debtor_code && <span className="text-slate-400"> · {so.debtor_code}</span>}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-semibold tabular-nums">{fmtMoney(so.total)}</p>
            <p className="text-xs text-slate-400">Source: {so.source}</p>
          </div>
        </div>
        {so.remarks && (
          <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            <span className="font-medium">Remark: </span>{so.remarks}
          </p>
        )}
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Order date" value={fmtDate(so.so_date)} />
          <Field label="Delivery phone" value={so.phone} />
          <Field label="Sales location" value={so.branch ? `${branchName(so.branch)} (${so.sales_location ?? so.branch})` : so.sales_location} />
          <Field label="Agent" value={so.agent} />
          <Field label="Credit term" value={so.credit_term} />
          <Field label="Transfer to (DO)" value={so.transfer_to} />
          <Field
            label="Created in AutoCount"
            value={[so.created_user, so.ac_created_at && fmtDateTime(so.ac_created_at)].filter(Boolean).join(" · ")}
          />
          {so.icb_from_po && <Field label="ICB from PO" value={so.icb_from_po} />}
          <div className="sm:col-span-2 lg:col-span-4">
            <Field label="Delivery address" value={so.address} />
          </div>
        </dl>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Items */}
          <section className="card overflow-hidden">
            <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Items</h2>
            {lines.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">No item lines imported.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-5 py-2.5">
                        <div className="font-medium">{l.item_code}</div>
                        <div className="text-xs text-slate-500">{l.description}</div>
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{fmtQty(l.qty)} {l.uom}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Delivery orders */}
          <section className="space-y-3">
            <h2 className="font-semibold">
              Delivery orders <span className="font-normal text-slate-400">({deliveries.length})</span>
            </h2>
            {deliveries.length === 0 && notImported.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
            {deliveries.map((d) => {
              const otherSos = (d.links ?? []).filter((l) => l.so_no !== so.so_no);
              return (
                <div key={d.id} className={`card p-4 ${d.cancelled ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{d.do_no}</span>
                      {d.cancelled ? (
                        <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">Cancelled</span>
                      ) : (
                        <DoBadge status={d.status as DoStatus} />
                      )}
                      {d.branch && (
                        <span className="rounded bg-slate-100 px-1.5 text-xs font-medium text-slate-600" title={`Delivered by ${branchName(d.branch)}`}>
                          by {d.branch}
                        </span>
                      )}
                    </div>
                    <span className="text-sm text-slate-500">
                      {fmtDate(d.delivery_date)}{d.time_slot && ` · est. ${TIME_SLOTS[d.time_slot as TimeSlot]}`} · {d.driver ? driverLabel(d.driver) : d.supplier_delivery ? "Supplier delivery" : "No driver"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    {d.do_items?.map((i) => `${i.description || i.item_code} × ${fmtQty(i.qty)}`).join(", ")}
                    {d.total != null && <span className="text-slate-400"> · {fmtMoney(d.total)}</span>}
                    {d.ref && <span className="text-slate-400"> · Ref. {d.ref}</span>}
                  </p>
                  {otherSos.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      Same trip also carries{" "}
                      {otherSos.map((l, i) => (
                        <span key={l.so_no}>
                          {i > 0 && ", "}
                          {l.so_id ? <Link href={`/orders/${l.so_id}`} className="text-brand-700 hover:underline">{l.so_no}</Link> : l.so_no}
                        </span>
                      ))}
                    </p>
                  )}
                  {d.failed_reason && <p className="mt-2 text-sm text-rose-600">Failed: {d.failed_reason}</p>}
                  {d.status === "delivered" && waApiEnabled() && (
                    <form action={resendDeliveredNotice.bind(null, d.id)} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      {d.wa_sent_at
                        ? <span className="text-emerald-700">✓ WhatsApp sent {fmtDateTime(d.wa_sent_at)}</span>
                        : <span className="text-rose-600">WhatsApp not sent{d.wa_error && `: ${d.wa_error}`}</span>}
                      <button className="text-brand-700 hover:underline">{d.wa_sent_at ? "Send again" : "Retry"}</button>
                    </form>
                  )}
                  {!!photoUrls[d.id]?.length && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {photoUrls[d.id].map((url, i) => (
                        <a key={url} href={url} target="_blank">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt={`Proof of delivery ${i + 1}`} className="h-24 rounded-lg border border-slate-200 object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {notImported.length > 0 && (
              <p className="text-sm text-slate-500">
                In AutoCount but not imported yet: {notImported.join(", ")}
              </p>
            )}
          </section>
        </div>

        {/* Timeline */}
        <aside className="card h-fit p-5">
          <h2 className="mb-4 font-semibold">Timeline</h2>
          <ol className="relative space-y-5 border-l border-slate-200 pl-5">
            {timeline.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[25px] top-1 size-2.5 rounded-full bg-brand-600 ring-4 ring-white" />
                <p className="text-sm font-medium">
                  {EVENT_LABEL[e.status] ?? e.status}
                  {e.do_id && doNoById.get(e.do_id) && <span className="font-normal text-slate-400"> · {doNoById.get(e.do_id)}</span>}
                </p>
                {e.note && <p className="text-sm text-slate-600">{e.note}</p>}
                <p className="text-xs text-slate-400">
                  {fmtDateTime(e.created_at)}{e.actor?.full_name && ` · ${e.actor.full_name}`}
                </p>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{value || "—"}</dd>
    </div>
  );
}
