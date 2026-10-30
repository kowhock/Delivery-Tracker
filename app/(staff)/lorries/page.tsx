import { requireStaff } from "@/lib/auth";
import { branchName, lockedBranches, pageBranch, userBranches } from "@/lib/branches";
import { todayMY } from "@/lib/format";
import type { Lorry, Profile } from "@/lib/types";
import { Lorries, type LorryJobs, type LorryEvent } from "@/components/Lorries";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";

export default async function LorriesPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireStaff();
  const today = todayMY();

  const [{ data: lorryRows }, { data: driverRows }] = await Promise.all([
    supabase.from("lorries").select("*").order("lorry_no"),
    supabase.from("profiles").select("id, full_name, branch").eq("role", "driver").order("full_name"),
  ]);
  const allLorries = (lorryRows ?? []) as Lorry[];
  const drivers = (driverRows ?? []) as Pick<Profile, "id" | "full_name" | "branch">[];

  // Same branch picker as Driver status (dispatchers stay on their own branches).
  const locked = lockedBranches(profile);
  const branch = pageBranch(sp.branch, profile);
  const branches = locked ?? [...new Set([...allLorries.map((l) => l.branch), ...drivers.map((d) => d.branch), branch].filter((b): b is string => !!b))].sort();
  const lorries = branch
    ? allLorries.filter((l) => l.branch === branch)
    : locked
      ? allLorries.filter((l) => l.branch && locked.includes(l.branch))
      : allLorries;

  // What each lorry's driver is doing today, and the lorry's latest history.
  const driverIds = lorries.map((l) => l.driver_id).filter((x): x is string => !!x);
  const jobs: Record<string, LorryJobs> = {};
  const events: Record<string, LorryEvent[]> = {};
  if (lorries.length) {
    const [{ data: jobRows }, { data: eventRows }] = await Promise.all([
      driverIds.length
        ? supabase
            .from("delivery_orders")
            .select("driver_id, do_no, status")
            .in("driver_id", driverIds)
            .eq("cancelled", false)
            .or(`delivery_date.eq.${today},status.eq.out_for_delivery`)
        : Promise.resolve({ data: [] as { driver_id: string; do_no: string; status: string }[] }),
      supabase
        .from("lorry_events")
        .select("id, lorry_id, note, created_at, actor:profiles(full_name)")
        .in("lorry_id", lorries.map((l) => l.id))
        .order("created_at", { ascending: false })
        .limit(300),
    ]);
    for (const j of jobRows ?? []) {
      const t = (jobs[j.driver_id] ??= { onRoad: [], left: 0, delivered: 0 });
      if (j.status === "out_for_delivery") t.onRoad.push(j.do_no);
      else if (j.status === "delivered") t.delivered += 1;
      else if (j.status === "assigned") t.left += 1;
    }
    for (const e of (eventRows ?? []) as unknown as (LorryEvent & { lorry_id: string })[]) {
      const list = (events[e.lorry_id] ??= []);
      if (list.length < 8) list.push(e);
    }
  }

  return (
    <div className="space-y-5">
      <RealtimeRefresh table="delivery_orders" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lorries</h1>
          <p className="text-sm text-slate-500">
            {branch ? `${branchName(branch)} branch · ` : locked ? `${locked.map(branchName).join(" + ")} branches · ` : "All branches · "}
            {lorries.length} {lorries.length === 1 ? "lorry" : "lorries"}
          </p>
        </div>
        {branches.length > 1 && (!locked || locked.length > 1) && (
          <form className="flex items-center gap-2">
            <select name="branch" defaultValue={branch || "all"} className="input w-auto">
              <option value="all">{locked ? "All my branches" : "All branches"}</option>
              {branches.map((b) => (
                <option key={b} value={b}>{branchName(b)}{!locked && userBranches(profile.branch).includes(b) ? " (mine)" : ""}</option>
              ))}
            </select>
            <button className="btn-secondary">Go</button>
          </form>
        )}
      </div>

      <Lorries
        lorries={lorries}
        allLorries={allLorries}
        drivers={drivers}
        jobs={jobs}
        events={events}
        today={today}
        branch={branch || null}
        lockedBranches={locked}
      />
    </div>
  );
}
