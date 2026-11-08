import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { canEditPoints } from "@/lib/access";
import { lockedBranches, pageBranch, userBranches } from "@/lib/branches";
import { dateRange, todayMY } from "@/lib/format";
import type { DeliveryOrder, Profile } from "@/lib/types";
import { DriverTrips, type DriverStats } from "@/components/DriverTrips";
import { CalculatePointsButton } from "@/components/PointsEditor";
import { dayTotals, sumDays, withTripPoints } from "@/lib/commission";
import { mapsEnabled } from "@/lib/geo";
import { withStartedAt } from "@/lib/delivery-times";
import { failedAttempts } from "@/lib/attempts";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { DateRangePicker } from "@/components/DateRangePicker";
import { getStaffT } from "@/lib/staff-lang";

const MAX_DAYS = 31;

export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; branch?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, profile } = await requireStaff();
  const { t } = await getStaffT();
  const T = t.drivers;

  const today = todayMY();
  const from = sp.from || today;
  const to = sp.to && sp.to >= from ? sp.to : from;
  const dates = dateRange(from, to, MAX_DAYS);

  // Opens on the user's own branch's drivers; they can switch to another branch or all
  // (dispatchers stay on their own branches).
  const { data: driverRows } = await supabase
    .from("profiles")
    .select("id, full_name, real_name, branch, lorry_no")
    .eq("role", "driver")
    .order("full_name");
  const allDrivers = (driverRows ?? []) as Pick<Profile, "id" | "full_name" | "real_name" | "branch" | "lorry_no">[];
  const locked = lockedBranches(profile);
  const branch = pageBranch(sp.branch, profile);
  const branches = locked ?? [...new Set([...allDrivers.map((d) => d.branch), branch].filter((b): b is string => !!b))].sort();
  const drivers = branch
    ? allDrivers.filter((d) => d.branch === branch)
    : locked
      ? allDrivers.filter((d) => d.branch && locked.includes(d.branch))
      : allDrivers;

  let jobs: DeliveryOrder[] = [];
  const stats: Record<string, DriverStats> = {};
  if (drivers.length) {
    // Commission counts what was actually delivered on each day (delivered_at), not the planned date.
    const end = new Date(dates[dates.length - 1] + "T00:00:00+08:00");
    end.setUTCDate(end.getUTCDate() + 1);
    const { data: deliveredRows } = await supabase
      .from("delivery_orders")
      .select("id, driver_id, delivery_date, trip_no, delivered_at, points, points_manual")
      .in("driver_id", drivers.map((d) => d.id))
      .eq("status", "delivered")
      .eq("cancelled", false)
      .gte("delivered_at", `${dates[0]}T00:00:00+08:00`)
      .lt("delivered_at", end.toISOString());
    // Failed attempts earn their points too.
    const failed = await failedAttempts(supabase, drivers.map((d) => d.id), `${dates[0]}T00:00:00+08:00`, end.toISOString());
    for (const d of drivers) {
      const mine = withTripPoints([...(deliveredRows ?? []), ...failed].filter((r) => r.driver_id === d.id));
      if (mine.length) stats[d.id] = sumDays(dayTotals(mine));
    }

    const { data } = await supabase
      .from("delivery_orders")
      .select("*, do_items(id), links:do_sales_orders(so_no, so_id)")
      .in("driver_id", drivers.map((d) => d.id))
      .eq("cancelled", false)
      .gte("delivery_date", dates[0])
      .lte("delivery_date", dates[dates.length - 1])
      .order("trip_no")
      .order("trip_seq")
      .order("created_at");
    jobs = await withStartedAt(supabase, (data ?? []) as DeliveryOrder[]);
  }
  const done = jobs.filter((j) => j.status === "delivered").length;
  const missingPoints = jobs.filter((j) => j.points == null && !j.points_manual).map((j) => j.id);

  return (
    <div className="space-y-5">
      <RealtimeRefresh table="delivery_orders" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{T.title}</h1>
          <p className="text-sm text-slate-500">
            {branch ? `${t.branchOf(branch)} · ` : locked ? `${t.branchesOf(locked.join(" + "))} · ` : branches.length ? `${t.allBranches} · ` : ""}
            {t.doneOf(done, jobs.length)}
          </p>
          {mapsEnabled() && <div className="mt-2"><CalculatePointsButton ids={missingPoints} /></div>}
        </div>
        <form className="flex flex-wrap items-center gap-2">
          {branches.length > 1 && (!locked || locked.length > 1) && (
            <select name="branch" defaultValue={branch || "all"} className="input w-auto">
              <option value="all">{locked ? T.allMine : t.allBranches}</option>
              {branches.map((b) => (
                <option key={b} value={b}>{b}{!locked && userBranches(profile.branch).includes(b) ? T.mine : ""}</option>
              ))}
            </select>
          )}
          {/* Quick jump back to today (keeps the branch picked). */}
          <Link
            href={`/drivers?${new URLSearchParams({ ...(sp.branch ? { branch: sp.branch } : {}), from: today, to: today })}`}
            aria-current={from === today && to === today ? "date" : undefined}
            className={`text-sm font-medium ${from === today && to === today ? "text-slate-900" : "text-brand-700 hover:underline"}`}
          >
            {t.today}
          </Link>
          <DateRangePicker key={`${from}|${to}`} from={from} to={to} today={today} max={MAX_DAYS} />
          <button className="btn-secondary">{t.go}</button>
        </form>
      </div>
      {dates[dates.length - 1] < to && (
        <p className="text-sm text-amber-700">{T.firstDays(MAX_DAYS)}</p>
      )}

      {drivers.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">
          {T.noDrivers(branch || null)} (<code>profiles.branch</code>).
        </div>
      ) : (
        <DriverTrips drivers={drivers} dates={dates} jobs={jobs} stats={stats} canEditPoints={canEditPoints(profile)} />
      )}
    </div>
  );
}
