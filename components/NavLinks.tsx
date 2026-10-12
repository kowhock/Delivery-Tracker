"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/types";

const LINKS: { href: string; label: string; adminOnly?: boolean }[] = [
  { href: "/deliveries", label: "Deliveries" },
  { href: "/drivers", label: "Driver status" },
  { href: "/orders", label: "Sales orders", adminOnly: true },
  { href: "/import", label: "Import", adminOnly: true },
  { href: "/driver", label: "Driver view" },
];

export function NavLinks({ role }: { role: Role }) {
  const pathname = usePathname();
  const links = LINKS.filter((l) => !l.adminOnly || role === "admin");
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto">
      {links.map((l) => {
        // Exact segment match so "/drivers" doesn't also light up "/driver".
        const active = pathname === l.href || pathname.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              active ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
