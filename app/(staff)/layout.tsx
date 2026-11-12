import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { signOut } from "../actions";
import { NavLinks } from "@/components/NavLinks";
import { deliveredOrSoldBy, lockedBranches } from "@/lib/branches";
import { getStaffT } from "@/lib/staff-lang";
import { StaffLangProvider, StaffLangToggle } from "@/components/StaffLang";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile } = await requireStaff();
  const { lang, t } = await getStaffT();
  // Badge on the Outstanding tab: not cleared yet (dispatchers: their branch's DOs only).
  const locked = lockedBranches(profile);
  let open = supabase.from("do_outstanding").select("id, delivery:delivery_orders!inner(id)", { count: "exact", head: true }).is("cleared_at", null);
  if (locked) open = open.or(deliveredOrSoldBy(locked), { referencedTable: "delivery" });
  const { count: outstanding } = await open;

  return (
    <StaffLangProvider lang={lang}>
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/80 backdrop-blur print:hidden">
        {/* Phones: menu tabs drop to their own row and wrap, so nothing scrolls sideways. */}
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:h-14 sm:flex-nowrap sm:py-0">
          <Link href="/deliveries" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/icons/logo.png" alt="" width={28} height={28} className="size-7 rounded-lg" />
            <span className="hidden sm:inline">KH Delivery</span>
          </Link>
          <div className="order-last w-full min-w-0 sm:order-none sm:w-auto">
            <NavLinks role={profile.role} outstanding={outstanding ?? 0} />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 md:inline">
              {profile.full_name} · <span className="capitalize">{t.role[profile.role] ?? profile.role}</span>
            </span>
            <StaffLangToggle />
            <form action={signOut}>
              <button className="text-sm font-medium text-slate-500 hover:text-slate-900">{t.signOut}</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 print:max-w-none print:p-0">{children}</main>
    </div>
    </StaffLangProvider>
  );
}
