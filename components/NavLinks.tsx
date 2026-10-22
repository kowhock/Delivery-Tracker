"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/types";

const LINKS: { href: string; label: string; adminOnly?: boolean }[] = [
  { href: "/deliveries", label: "Deliveries" },
  { href: "/drivers", label: "Driver status" },
  { href: "/outstanding", label: "Outstanding" },
  { href: "/lorries", label: "Lorries" },
  { href: "/trip-form", label: "Trip form" },
  { href: "/driver", label: "Driver view" },
];

/** `outstanding`: DOs flagged and not cleared yet, shown as a badge on that tab. */
export function NavLinks({ role, outstanding = 0 }: { role: Role; outstanding?: number }) {
  const pathname = usePathname();
  const links = LINKS.filter((l) => !l.adminOnly || role === "admin");
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto">
      {links.map((l) => {
        // Exact segment match so "/drivers" doesn't also light up "/driver".
        const active = pathname === l.href || pathname.startsWith(l.href + "/");
        // Outstanding: red while anything isn't cleared, green when all clear (ring = current page).
        const look =
          l.href === "/outstanding"
            ? `${outstanding > 0 ? "bg-rose-600 hover:bg-rose-700 ring-rose-300" : "bg-emerald-600 hover:bg-emerald-700 ring-emerald-300"} text-white ${active ? "ring-2" : ""}`
            : active
              ? "bg-brand-50 text-brand-700"
              : "text-slate-500 hover:bg-slate-100 hover:text-slate-900";
        return (
          <Link key={l.href} href={l.href} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${look}`}>
            {l.label}
            {l.href === "/outstanding" && outstanding > 0 && (
              <span className="ml-1.5 rounded-full bg-white px-1.5 text-xs font-semibold text-rose-700">{outstanding}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
