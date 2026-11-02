import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { SPECIAL_ORDER_BRANCHES } from "@/lib/special";
import { SdoGoodsToggle } from "@/components/SdoGoodsToggle";

/** Admin: which dispatchers may make, edit and print Tumpang Barang special orders. */
export default async function SpecialOrderAccessPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("profiles").select("id, full_name, branch, sdo_goods").eq("role", "dispatcher").order("full_name");
  const dispatchers = (data ?? []) as { id: string; full_name: string; branch: string | null; sdo_goods: boolean | null }[];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/deliveries" className="text-sm text-slate-500 hover:text-slate-900">← Deliveries</Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Special order access</h1>
        <p className="text-sm text-slate-500">
          Ticked dispatchers can create, edit and print <b>Tumpang Barang</b> special orders
          ({SPECIAL_ORDER_BRANCHES.join(", ")} branch). Admins always can. Only admins can void.
        </p>
      </div>
      <div className="card divide-y divide-slate-100">
        {dispatchers.map((d) => (
          <SdoGoodsToggle key={d.id} profileId={d.id} name={d.full_name} branch={d.branch} allowed={!!d.sdo_goods} />
        ))}
        {dispatchers.length === 0 && <p className="p-5 text-sm text-slate-500">No dispatchers yet.</p>}
      </div>
    </div>
  );
}
