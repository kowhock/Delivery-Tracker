import Link from "next/link";
import { branchName } from "@/lib/branches";
import type { DeliveryOrder } from "@/lib/types";
import { SoPopup } from "./SoPopup";

/**
 * The SO number(s) a DO came from, each linking to its SO page when that SO has been imported.
 * `popup`: open the SO in a popup instead (dispatchers can't open the SO page).
 */
export function SoLinks({ job, popup = false, className = "" }: { job: Pick<DeliveryOrder, "so_no" | "links">; popup?: boolean; className?: string }) {
  const links = job.links?.length ? job.links : job.so_no ? job.so_no.split(", ").map((so_no) => ({ so_no, so_id: null })) : [];
  if (!links.length) return null;
  return (
    <span className={className}>
      {links.map((l, i) => (
        <span key={l.so_no}>
          {i > 0 && ", "}
          {l.so_id && popup ? (
            <SoPopup soId={l.so_id} soNo={l.so_no} />
          ) : l.so_id ? (
            <Link href={`/orders/${l.so_id}`} className="text-brand-700 hover:underline" draggable={false}>{l.so_no}</Link>
          ) : (
            l.so_no
          )}
        </span>
      ))}
    </span>
  );
}

/** "PD" = branch that delivers; "for GP" = agent's branch, shown only when it's a different branch. */
export function BranchTags({ job }: { job: Pick<DeliveryOrder, "branch" | "sales_branch"> }) {
  if (!job.branch && !job.sales_branch) return null;
  return (
    <span className="inline-flex gap-1">
      {job.branch && (
        <span className="rounded bg-slate-100 px-1.5 font-medium text-slate-600" title={`Delivered by ${branchName(job.branch)}`}>
          {job.branch}
        </span>
      )}
      {job.sales_branch && job.sales_branch !== job.branch && (
        <span className="rounded bg-amber-50 px-1.5 font-medium text-amber-700" title={`Sold by ${branchName(job.sales_branch)}`}>
          for {job.sales_branch}
        </span>
      )}
    </span>
  );
}
