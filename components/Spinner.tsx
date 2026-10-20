/** Turning circle shown while a page loads its data. */
export function Spinner({ className = "border-brand-600", label = "Loading…" }: { className?: string; label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-24 text-sm text-slate-500">
      <span className={`size-10 animate-spin rounded-full border-4 border-t-transparent ${className}`} aria-hidden />
      {label}
    </div>
  );
}
