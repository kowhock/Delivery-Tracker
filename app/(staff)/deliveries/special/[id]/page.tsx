import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { lockedBranches } from "@/lib/branches";
import { deleteSpecialDo, updateSpecialDo } from "@/app/actions";
import { SpecialDoForm } from "@/components/SpecialDoForm";
import type { DeliveryOrder, Profile } from "@/lib/types";

/** Edit or delete a special DO — only by whoever created it (or an admin), and only before the driver starts it. */
export default async function EditSpecialDoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, profile } = await requireStaff();
  const [{ data: job }, { data: driverRows }] = await Promise.all([
    supabase.from("delivery_orders").select("*").eq("id", id).eq("source", "special").maybeSingle<DeliveryOrder>(),
    supabase.from("profiles").select("id, full_name, lorry_no, branch").eq("role", "driver").order("full_name"),
  ]);
  if (!job) notFound();
  const drivers = (driverRows ?? []) as Pick<Profile, "id" | "full_name" | "lorry_no" | "branch">[];
  const allowed = job.created_by === user.id || profile.role === "admin";
  const editable = ["pending", "assigned", "failed"].includes(job.status);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/deliveries" className="text-sm text-slate-500 hover:text-slate-900">← Deliveries</Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit special DO · {job.do_no}</h1>
        <p className="text-sm text-slate-500">Changes show on the driver&apos;s phone straight away.</p>
      </div>

      {!allowed ? (
        <p className="card p-5 text-sm text-slate-600">Only the person who created this special DO can edit or delete it.</p>
      ) : !editable ? (
        <p className="card p-5 text-sm text-slate-600">
          This special DO can&apos;t be changed any more — the driver has already started or delivered it.
        </p>
      ) : (
        <SpecialDoForm
          action={updateSpecialDo.bind(null, job.id)}
          onDelete={deleteSpecialDo.bind(null, job.id)}
          drivers={drivers}
          lockedTo={lockedBranches(profile)}
          submitLabel="Save changes"
          values={job}
        />
      )}
    </div>
  );
}
