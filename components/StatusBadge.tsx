import { DO_STATUS_LABEL, SO_STATUS_LABEL, type DoStatus, type SoStatus } from "@/lib/types";

const DO_STYLE: Record<DoStatus, string> = {
  pending: "bg-slate-100 text-slate-700 ring-slate-200",
  assigned: "bg-sky-50 text-sky-700 ring-sky-200",
  out_for_delivery: "bg-amber-50 text-amber-800 ring-amber-200",
  delivered: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
};

const SO_STYLE: Record<SoStatus, string> = {
  open: "bg-slate-100 text-slate-700 ring-slate-200",
  partial: "bg-amber-50 text-amber-800 ring-amber-200",
  fulfilled: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  cancelled: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};

const base = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap";

export function DoBadge({ status, label }: { status: DoStatus; label?: string }) {
  return (
    <span className={`${base} ${DO_STYLE[status]}`}>
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {label ?? DO_STATUS_LABEL[status]}
    </span>
  );
}

export function SoBadge({ status }: { status: SoStatus }) {
  return <span className={`${base} ${SO_STYLE[status]}`}>{SO_STATUS_LABEL[status]}</span>;
}
