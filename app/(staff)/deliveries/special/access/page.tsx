import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { StaffAccessToggle } from "@/components/StaffAccessToggle";

/** Admin: what each dispatcher may do beyond the usual (lib/access.ts). Admins always can. */
export default async function AdminAccessPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("profiles").select("id, full_name, branch, sdo_goods, points_edit").eq("role", "dispatcher").order("full_name");
  const dispatchers = (data ?? []) as { id: string; full_name: string; branch: string | null; sdo_goods: boolean | null; points_edit: boolean | null }[];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/deliveries" className="text-sm text-slate-500 hover:text-slate-900">← Deliveries</Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin access</h1>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-500">
          <li>
            <b>Special order</b>: create, edit and print Kurang Hantar special orders (every branch),
            and edit special orders once printed. Ambil Barang and System Down are open to all staff until printed.
          </li>
          <li>
            <b>Edit points</b>: change a DO&apos;s points on Driver status and the trip form. Anyone can set points on the special DO form.
            Anyone can still run &quot;Calculate missing points&quot;.
          </li>
          <li>Admins can always do both. Only admins can void.</li>
        </ul>
      </div>
      <div className="card divide-y divide-slate-100">
        {dispatchers.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
            <span className="flex-1 text-sm font-medium">
              {d.full_name}
              {d.branch && <span className="ml-2 text-xs font-normal text-slate-500">{d.branch}</span>}
            </span>
            <StaffAccessToggle profileId={d.id} access="sdo_goods" allowed={!!d.sdo_goods} />
            <StaffAccessToggle profileId={d.id} access="points_edit" allowed={!!d.points_edit} />
          </div>
        ))}
        {dispatchers.length === 0 && <p className="p-5 text-sm text-slate-500">No dispatchers yet.</p>}
      </div>
    </div>
  );
}
