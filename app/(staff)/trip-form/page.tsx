import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { branchName, lockedBranches } from "@/lib/branches";
import { addDays, dateRange, fmtTime, mapAddress, todayMY } from "@/lib/format";
import { startedTimes } from "@/lib/delivery-times";
import { failedAttempts, type FailedAttempt } from "@/lib/attempts";
import { commissionForDay, withTripPoints } from "@/lib/commission";
import { lorryLabel, type Lorry, type Profile } from "@/lib/types";
import { TripForm, type TripDay } from "@/components/TripForm";
import { BranchDriverPicker } from "@/components/BranchDriverPicker";
import { fromTripForm } from "@/app/actions";

const MAX_DAYS = 31; // the monthly form has 31 rows

const TZ = "Asia/Kuala_Lumpur";
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });

export default async function TripFormPage({
  searchParams,
}: {
  searchParams: Promise<{ driver?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, profile } = await requireStaff();
  const today = todayMY();
  const from = sp.from || today;
  const to = sp.to && sp.to >= from ? sp.to : from;
  const dates = dateRange(from, to, MAX_DAYS);

  // Dispatchers only see their own branches' drivers.
  const locked = lockedBranches(profile);
  let q = supabase.from("profiles").select("id, full_name, branch").eq("role", "driver").order("full_name");
  if (locked) q = q.in("branch", locked);
  const drivers = ((await q).data ?? []) as Pick<Profile, "id" | "full_name" | "branch">[];
  const driver = drivers.find((d) => d.id === sp.driver) ?? drivers[0];

  let days: TripDay[] = [];
  let lorry = "";
  if (driver) {
    // Commission counts what was delivered on each day (delivered_at), like Driver status,
    // and every failed attempt on the day it failed (with a "Failed" remark).
    const dayStart = `${dates[0]}T00:00:00+08:00`;
    const dayEnd = `${addDays(dates[dates.length - 1], 1)}T00:00:00+08:00`;
    const { data: rows } = await supabase
      .from("delivery_orders")
      .select("id, do_no, customer_name, address, map_address, driver_id, delivery_date, trip_no, points, points_manual, delivered_at, lorry_id")
      .eq("driver_id", driver.id)
      .eq("status", "delivered")
      .eq("cancelled", false)
      .gte("delivered_at", dayStart)
      .lt("delivered_at", dayEnd)
      .order("delivered_at");
    const failed = await failedAttempts(supabase, [driver.id], dayStart, dayEnd);
    const delivered = withTripPoints<NonNullable<typeof rows>[number] & Partial<FailedAttempt>>([...(rows ?? []), ...failed]).sort((a, b) => a.delivered_at!.localeCompare(b.delivered_at!));

    // Time in = when the driver tapped Start (the last time, if started more than once).
    // A failed attempt keeps the start of that attempt.
    const started = await startedTimes(supabase, (rows ?? []).map((d) => d.id));
    const typedIn = new Set(await fromTripForm((rows ?? []).map((d) => d.id)));

    // Lorries used (stamped on each DO when delivered); else the driver's lorry now.
    const lorryIds = [...new Set(delivered.map((d) => d.lorry_id).filter((x): x is string => !!x))];
    const { data: lorryRows } = await supabase
      .from("lorries")
      .select("id, lorry_no, plate_no, driver_id")
      .or(`driver_id.eq.${driver.id}${lorryIds.length ? `,id.in.(${lorryIds.join(",")})` : ""}`);
    const lorries = (lorryRows ?? []) as Pick<Lorry, "id" | "lorry_no" | "plate_no" | "driver_id">[];
    const labelOf = (id: string | null) => {
      const l = lorries.find((x) => x.id === id) ?? lorries.find((x) => x.driver_id === driver.id);
      return l ? lorryLabel(l) : "";
    };
    lorry = [...new Set(delivered.map((d) => labelOf(d.lorry_id)).filter(Boolean))].join(", ") || labelOf(null);

    days = dates.map((date) => {
      const mine = delivered.filter((d) => d.delivered_at && dayOf(d.delivered_at) === date);
      const points = mine.reduce((s, d) => s + (d.points ?? 0), 0);
      return {
        date,
        points,
        rm: commissionForDay(points),
        trips: new Set(mine.map((d) => `${d.delivery_date}|${d.trip_no}`)).size,
        lorry: [...new Set(mine.map((d) => labelOf(d.lorry_id)).filter(Boolean))].join(", ") || lorry,
        missingPoints: mine.filter((d) => d.points == null).length,
        dos: mine.map((d) => ({
          id: d.id,
          doNo: d.do_no,
          location: mapAddress(d) || d.customer_name,
          timeIn: fmtTime(d.failed ? d.started_at : started.get(d.id)),
          timeBack: fmtTime(d.delivered_at),
          points: d.points,
          manual: d.points_manual && d.points != null,
          original: d.map_address?.trim() && d.address && d.map_address.trim() !== d.address.trim() ? d.address : "",
          failed: d.failed ? d.failed_reason || "Failed" : "",
          fromTripForm: !d.failed && typedIn.has(d.id),
        })),
      };
    });
  }

  const params = (p: Record<string, string>) => "?" + new URLSearchParams({ ...(driver ? { driver: driver.id } : {}), from, to, ...p }).toString();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trip form</h1>
        </div>
        <form className="flex flex-wrap items-center gap-2">
          {locked ? (
            <select name="driver" defaultValue={driver?.id} aria-label="Driver" className="input w-auto">
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>{d.full_name}</option>
              ))}
            </select>
          ) : (
            <BranchDriverPicker drivers={drivers} driverId={driver?.id} />
          )}
          <label className="flex items-center gap-1.5 text-sm text-slate-500">
            From <input type="date" name="from" defaultValue={from} className="input w-auto" />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-500">
            To <input type="date" name="to" defaultValue={to} className="input w-auto" />
          </label>
          <button className="btn-secondary">Go</button>
          <Link href={params({ from: today, to: today })} className="btn-secondary">
            Today
          </Link>
        </form>
      </div>
      {dates[dates.length - 1] < to && (
        <p className="text-sm text-amber-700 print:hidden">Showing the first {MAX_DAYS} days only — pick a shorter range to see the rest.</p>
      )}

      {!driver ? (
        <div className="card p-10 text-center text-slate-500">No drivers yet.</div>
      ) : (
        <TripForm
          key={`${driver.id}|${from}|${to}`}
          driver={driver.full_name}
          branch={branchName(driver.branch)}
          lorry={lorry}
          from={dates[0]}
          to={dates[dates.length - 1]}
          days={days}
          driverId={driver.id}
        />
      )}
    </div>
  );
}
