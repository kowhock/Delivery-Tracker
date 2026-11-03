import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { lockedBranches } from "@/lib/branches";
import { fmtDateTime } from "@/lib/format";
import { updateSpecialDo } from "@/app/actions";
import { SpecialDoForm } from "@/components/SpecialDoForm";
import { VoidSpecialDo } from "@/components/VoidSpecialDo";
import { canEditSpecial, canHandleGoods, canPrintSpecial, isGoodsReason, usesSpecialOrders } from "@/lib/special";
import type { DeliveryOrder, Profile } from "@/lib/types";

/**
 * Edit a special DO before the driver starts it. Who may: see canEditSpecial (lib/special.ts).
 * Kurang Hantar orders also print from here. Every special DO is voided here by an admin, never deleted.
 */
export default async function EditSpecialDoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, profile } = await requireStaff();
  const [{ data: job }, { data: driverRows }] = await Promise.all([
    supabase
      .from("delivery_orders")
      .select("*, do_items(id, item_code, description, uom, qty), voider:profiles!delivery_orders_voided_by_fkey(full_name)")
      .eq("id", id)
      .eq("source", "special")
      .maybeSingle<DeliveryOrder & { voider: { full_name: string } | null }>(),
    supabase.from("profiles").select("id, full_name, lorry_no, branch").eq("role", "driver").order("full_name"),
  ]);
  if (!job) notFound();
  const drivers = (driverRows ?? []) as Pick<Profile, "id" | "full_name" | "lorry_no" | "branch">[];
  const who = { ...profile, id: user.id };
  const allowed = canEditSpecial(job, who);
  const editable = ["pending", "assigned", "failed"].includes(job.status);
  const special = usesSpecialOrders(job.branch);
  const goods = isGoodsReason(job.special_reason);
  const printable = canPrintSpecial(job, who);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/deliveries" className="text-sm text-slate-500 hover:text-slate-900">← Deliveries</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {special ? "Special order" : "Edit special DO"} · {job.do_no}
            {job.voided_at && <span className="ml-2 rounded bg-rose-600 px-2 py-0.5 align-middle text-sm font-bold text-white">VOID</span>}
          </h1>
        </div>
        {printable && (
          <Link href={`/deliveries/special/${job.id}/print`} className="btn-primary">
            {job.print_count > 0 ? "Reprint" : "Print"}
          </Link>
        )}
      </div>

      {job.voided_at ? (
        <p className="card border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
          Voided {fmtDateTime(job.voided_at)}{job.voider && ` by ${job.voider.full_name}`}. It stays on record but can&apos;t be changed, printed or delivered.
        </p>
      ) : !allowed ? (
        <p className="card p-5 text-sm text-slate-600">
          {job.print_count > 0
            ? `This special order was printed${job.printed_at ? ` on ${fmtDateTime(job.printed_at)}` : ""}. Only admins and dispatchers an admin has allowed can edit it now.`
            : goods
            ? "Only admins and dispatchers an admin has allowed can edit Kurang Hantar special orders."
            : "Only the person who created this special DO can edit it."}
        </p>
      ) : !editable ? (
        <p className="card p-5 text-sm text-slate-600">
          This special DO can&apos;t be changed any more — the driver has already started or delivered it.
        </p>
      ) : (
        <SpecialDoForm
          action={updateSpecialDo.bind(null, job.id)}
          drivers={drivers}
          lockedTo={lockedBranches(profile)}
          submitLabel="Save changes"
          values={job}
          canGoods={canHandleGoods(profile)}
          items={job.do_items ?? []}
        />
      )}

      {!job.voided_at && profile.role === "admin" && <VoidSpecialDo doId={job.id} doNo={job.do_no} />}
    </div>
  );
}
