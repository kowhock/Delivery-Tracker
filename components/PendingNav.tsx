"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useTransition, type ComponentProps } from "react";

/**
 * Filter links and forms that keep the current page on screen while the next one loads,
 * showing a small spinner (and dimming the results) instead of a blank loading page.
 */
const Ctx = createContext<{ pending: boolean; go: (href: string) => void }>({ pending: false, go: () => {} });

export function PendingNav({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (href: string) => start(() => router.push(href, { scroll: false }));
  return <Ctx.Provider value={{ pending, go }}>{children}</Ctx.Provider>;
}

export function NavLink({ href, onClick, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const { go } = useContext(Ctx);
  return (
    <Link
      href={href}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        // Ctrl/Cmd-click etc. still open a new tab as usual.
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        go(href);
      }}
    />
  );
}

/** A GET form (like a plain <form>) that navigates in place. */
export function NavForm({ children, className }: { children: React.ReactNode; className?: string }) {
  const { go } = useContext(Ctx);
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const qs = new URLSearchParams();
        for (const [k, v] of new FormData(e.currentTarget)) qs.append(k, String(v));
        go(`${window.location.pathname}?${qs}`);
      }}
    >
      {children}
    </form>
  );
}

export function PendingSpinner() {
  const { pending } = useContext(Ctx);
  if (!pending) return null;
  return (
    <span role="status" className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className="size-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden />
      Loading…
    </span>
  );
}

/** Fades what's below while new results load. */
export function PendingDim({ children }: { children: React.ReactNode }) {
  const { pending } = useContext(Ctx);
  return <div className={`transition-opacity ${pending ? "pointer-events-none opacity-50" : ""}`}>{children}</div>;
}
