import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { signOut } from "../actions";
import { NavLinks } from "@/components/NavLinks";
import { deliveredOrSoldBy, lockedBranches } from "@/lib/branches";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile } = await requireStaff();
  // Badge on the Outstanding tab: not cleared yet (dispatchers: their branch's DOs only).
  const locked = lockedBranches(profile);
  let open = supabase.from("do_outstanding").select("id, delivery:delivery_orders!inner(id)", { count: "exact", head: true }).is("cleared_at", null);
  if (locked) open = open.or(deliveredOrSoldBy(locked), { referencedTable: "delivery" });
  const { count: outstanding } = await open;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/80 backdrop-blur print:hidden">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link href="/deliveries" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/icons/logo.png" alt="" width={28} height={28} className="size-7 rounded-lg" />
            <span className="hidden sm:inline">KH Delivery</span>
          </Link>
          <NavLinks role={profile.role} outstanding={outstanding ?? 0} />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 md:inline">
              {profile.full_name} · <span className="capitalize">{profile.role}</span>
            </span>
            <form action={signOut}>
              <button className="text-sm font-medium text-slate-500 hover:text-slate-900">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
