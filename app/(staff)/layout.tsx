import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { signOut } from "../actions";
import { NavLinks } from "@/components/NavLinks";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireStaff();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link href="/deliveries" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/icons/logo.png" alt="" width={28} height={28} className="size-7 rounded-lg" />
            <span className="hidden sm:inline">Delivery Tracker</span>
          </Link>
          <NavLinks role={profile.role} />
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
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
