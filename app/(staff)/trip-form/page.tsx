import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { canEditPoints } from "@/lib/access";
import { branchName, lockedBranches } from "@/lib/branches";
import { dateRange, fmtTime, mapAddress, todayMY } from "@/lib/format";
import { startedTimes } from "@/lib/delivery-times";
import { failedAttempts, type FailedAttempt } from "@/lib/attempts";
import { commissionForDay, withTripPoints } from "@/lib/commission";
import { lorryLabel, type Lorry, type Profile } from "@/lib/types";
import { TripForm, type TripDay } from "@/components/TripForm";
import { BranchDriverPicker } from "@/components/BranchDriverPicker";
import { DateRangePicker } from "@/components/DateRangePicker";
import { fromTripForm } from "@/app/actions";

const MAX_DAYS = 31; // the monthly form has 31 rows


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
  const savedNotes: Record<string, Record<string, string>> = {};
  if (driver) {
    // What the office typed on the form and saved (saveTripNote): Remarks, lorry checks, trips.
    const { data: noteRows } = await supabase
      .from("trip_form_notes")
      .select("date, field, value")
      .eq("driver_id", driver.id)
      .gte("date", dates[0])
      .lte("date", dates[dates.length - 1]);
    for (const n of noteRows ?? []) (savedNotes[n.date] ??= {})[n.field] = n.value;

    // Every DO the office gave this driver for each day (delivery_date), whatever its status, plus every
    // failed attempt on those days (with a "Failed" remark). Only delivered DOs and failed attempts earn
    // points; one not delivered shows red until the office fills in its times (it then counts on that day).
    const { data: rows } = await supabase
      .from("delivery_orders")
      .select("id, do_no, customer_name, address, map_address, driver_id, delivery_date, trip_no, trip_seq, status, points, points_manual, delivered_at, lorry_id")
      .eq("driver_id", driver.id)
      .in("status", ["assigned", "out_for_delivery", "delivered"])
      .eq("cancelled", false)
      .gte("delivery_date", dates[0])
      .lte("delivery_date", dates[dates.length - 1]);
    const failed = await failedAttempts(supabase, [driver.id], dates[0], dates[dates.length - 1]);
    const done = (rows ?? []).filter((d) => d.status === "delivered");
    const todo = (rows ?? []).filter((d) => d.status !== "delivered").sort((a, b) => a.trip_no - b.trip_no || a.trip_seq - b.trip_seq);
    const delivered = withTripPoints<Omit<(typeof done)[number], "status" | "trip_seq"> & Partial<FailedAttempt>>([...done, ...failed]).sort((a, b) => a.delivered_at!.localeCompare(b.delivered_at!));

    // Time in = when the driver tapped Start (the last time, if started more than once).
    // A failed attempt keeps the start of that attempt.
    const started = await startedTimes(supabase, (rows ?? []).map((d) => d.id));
    const typedIn = new Set(await fromTripForm(done.map((d) => d.id)));

    // Lorries used (stamped on each DO when delivered); else the driver's lorry now.
    const lorryIds = [...new Set([...delivered, ...todo].map((d) => d.lorry_id).filter((x): x is string => !!x))];
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
      const mine = delivered.filter((d) => d.delivery_date === date);
      const notDone = todo.filter((d) => d.delivery_date === date);
      const points = mine.reduce((s, d) => s + (d.points ?? 0), 0);
      return {
        date,
        points,
        rm: commissionForDay(points),
        trips: new Set(mine.map((d) => `${d.delivery_date}|${d.trip_no}`)).size,
        lorry: [...new Set(mine.map((d) => labelOf(d.lorry_id)).filter(Boolean))].join(", ") || lorry,
        missingPoints: mine.filter((d) => d.points == null).length,
        notDone: notDone.length,
        dos: [
          ...mine.map((d) => ({
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
          // Given for this day but not delivered: no points until the office fills in both times.
          ...notDone.map((d) => ({
            id: d.id,
            doNo: d.do_no,
            location: mapAddress(d) || d.customer_name,
            timeIn: "",
            timeBack: "",
            points: null,
            manual: false,
            original: d.map_address?.trim() && d.address && d.map_address.trim() !== d.address.trim() ? d.address : "",
            notDone: true,
          })),
        ],
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
        <form className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {locked ? (
            <select name="driver" defaultValue={driver?.id} aria-label="Driver" className="input w-auto">
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>{d.full_name}</option>
              ))}
            </select>
          ) : (
            <BranchDriverPicker drivers={drivers} driverId={driver?.id} />
          )}
          <DateRangePicker key={`${from}|${to}`} from={from} to={to} today={today} max={MAX_DAYS} />
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
          canEditPoints={canEditPoints(profile)}
          savedNotes={savedNotes}
        />
      )}
    </div>
  );
}
