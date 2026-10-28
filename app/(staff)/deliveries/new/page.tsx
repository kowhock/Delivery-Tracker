import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { lockedBranches, userBranches } from "@/lib/branches";
import { todayMY } from "@/lib/format";
import { createSpecialDo } from "@/app/actions";
import { SpecialDoForm } from "@/components/SpecialDoForm";
import type { Profile } from "@/lib/types";

export default async function NewSpecialDoPage() {
  const { supabase, profile } = await requireStaff();
  const { data } = await supabase.from("profiles").select("id, full_name, lorry_no").eq("role", "driver").order("full_name");
  const drivers = (data ?? []) as Pick<Profile, "id" | "full_name" | "lorry_no">[];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/deliveries" className="text-sm text-slate-500 hover:text-slate-900">← Deliveries</Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New special DO</h1>
        <p className="text-sm text-slate-500">
          For deliveries that aren&apos;t an AutoCount DO — e.g. a stock transfer or a pick-up. It gets an SDO number and
          counts toward the driver&apos;s daily deliveries like any other DO.
        </p>
      </div>

      <SpecialDoForm
        action={createSpecialDo}
        drivers={drivers}
        lockedTo={lockedBranches(profile)}
        submitLabel="Create special DO"
        values={{
          customer_name: "",
          address: null,
          contact_phone: null,
          delivery_date: todayMY(),
          branch: userBranches(profile.branch)[0] ?? null,
          driver_id: null,
          points: null,
          instructions: null,
        }}
      />
    </div>
  );
}
