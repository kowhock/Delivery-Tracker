import { requireStaff } from "@/lib/auth";
import { lockedBranch, pickBranch } from "@/lib/branches";
import { dateRange, todayMY } from "@/lib/format";
import type { DeliveryOrder, Profile } from "@/lib/types";
import { DriverTrips, type DriverStats } from "@/components/DriverTrips";
import { CalculatePointsButton } from "@/components/PointsEditor";
import { dayTotals, sumDays, withTripPoints } from "@/lib/commission";
import { mapsEnabled } from "@/lib/geo";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";

const MAX_DAYS = 31;

export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; branch?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, profile } = await requireStaff();

  const from = sp.from || todayMY();
  const to = sp.to && sp.to >= from ? sp.to : from;
  const dates = dateRange(from, to, MAX_DAYS);

  // Opens on the user's own branch's drivers; they can switch to another branch or all
  // (dispatchers stay on their own branch).
  const { data: driverRows } = await supabase
    .from("profiles")
    .select("id, full_name, branch, lorry_no")
    .eq("role", "driver")
    .order("full_name");
  const allDrivers = (driverRows ?? []) as Pick<Profile, "id" | "full_name" | "branch" | "lorry_no">[];
  const locked = lockedBranch(profile);
  const branch = locked ?? pickBranch(sp.branch, profile.branch);
  const branches = [...new Set([...allDrivers.map((d) => d.branch), branch].filter((b): b is string => !!b))].sort();
  const drivers = branch ? allDrivers.filter((d) => d.branch === branch) : allDrivers;

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
    for (const d of drivers) {
      const mine = withTripPoints((deliveredRows ?? []).filter((r) => r.driver_id === d.id));
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
    jobs = (data ?? []) as DeliveryOrder[];
  }
  const done = jobs.filter((j) => j.status === "delivered").length;
  const missingPoints = jobs.filter((j) => j.points == null && !j.points_manual).map((j) => j.id);

  return (
    <div className="space-y-5">
      <RealtimeRefresh table="delivery_orders" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Driver status</h1>
          <p className="text-sm text-slate-500">
            {branch ? `${branch} branch · ` : branches.length ? "All branches · " : ""}
            {done} of {jobs.length} delivered · drag orders to arrange trips · click ⭐ to set points
          </p>
          {mapsEnabled() && <div className="mt-2"><CalculatePointsButton ids={missingPoints} /></div>}
        </div>
        <form className="flex flex-wrap items-center gap-2">
          {branches.length > 0 && !locked && (
            <select name="branch" defaultValue={branch || "all"} className="input w-auto">
              <option value="all">All branches</option>
              {branches.map((b) => (
                <option key={b} value={b}>{b}{b === profile.branch ? " (mine)" : ""}</option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-1.5 text-sm text-slate-500">
            From <input type="date" name="from" defaultValue={from} className="input w-auto" />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-500">
            To <input type="date" name="to" defaultValue={to} className="input w-auto" />
          </label>
          <button className="btn-secondary">Go</button>
        </form>
      </div>
      {dates[dates.length - 1] < to && (
        <p className="text-sm text-amber-700">Showing the first {MAX_DAYS} days only — pick a shorter range to see the rest.</p>
      )}

      {drivers.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">
          No drivers {branch ? `in ${branch} branch` : "yet"}. Set a driver&apos;s branch in Supabase (<code>profiles.branch</code>).
        </div>
      ) : (
        <DriverTrips drivers={drivers} dates={dates} jobs={jobs} stats={stats} />
      )}
    </div>
  );
}
