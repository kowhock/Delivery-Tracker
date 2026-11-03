import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { PRINT_HELP, canPrintSpecial } from "@/lib/special";
import type { DeliveryOrder } from "@/lib/types";
import { SpecialOrderSheet, type SheetOrder } from "@/components/SpecialOrderSheet";

/** Kurang Hantar, Ambil Barang and System Down SDOs print as a Delivery Order (canPrintSpecial). After printing, only authorised people can edit it. */
export default async function PrintSpecialOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, profile } = await requireStaff();
  const { data: job } = await supabase
    .from("delivery_orders")
    .select(
      "*, do_items(id, item_code, description, uom, qty), driver:profiles!delivery_orders_driver_id_fkey(full_name, lorry_no), creator:profiles!delivery_orders_created_by_fkey(full_name), printer:profiles!delivery_orders_printed_by_fkey(full_name)"
    )
    .eq("id", id)
    .eq("source", "special")
    .maybeSingle<SheetOrder & DeliveryOrder>();
  if (!job) notFound();

  if (!canPrintSpecial(job, { ...profile, id: user.id })) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <Link href={`/deliveries/special/${id}`} className="text-sm text-slate-500 hover:text-slate-900">← {job.do_no}</Link>
        <p className="card p-5 text-sm text-slate-600">
          {job.voided_at
            ? `${job.do_no} is void and can't be printed.`
            : PRINT_HELP}
        </p>
      </div>
    );
  }
  return <SpecialOrderSheet order={job} printedByName={profile.full_name} />;
}
