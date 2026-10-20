import { getSession } from "@/lib/auth";
import { fmtDate, todayMY } from "@/lib/format";
import type { DeliveryOrder } from "@/lib/types";
import { JobCard } from "@/components/JobCard";
import { CommissionBar } from "@/components/CommissionBar";
import { dayTotals, withTripPoints } from "@/lib/commission";
import { signOut } from "../actions";
import Link from "next/link";
import { cookies } from "next/headers";
import { DICT, LANG_COOKIE, toLang } from "@/lib/i18n";
import { LangToggle } from "@/components/LangToggle";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";

/** YYYY-MM-DD moved by `days`. */
function shiftDate(d: string, days: number): string {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
}

export default async function DriverPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { supabase, user, profile } = await getSession();
  const today = todayMY();
  const sp = await searchParams;
  // Always opens on today; the driver can pick another day to look back.
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const isToday = date === today;
  const lang = toLang((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICT[lang];
  const day_ = (d: string) => fmtDate(d, t.locale);
  // Header only: "20 Oct", no year.
  const dayMonth = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString(t.locale, { day: "numeric", month: "short", timeZone: "UTC" });

  // Commission counts what this driver delivered on the day (by delivery time).
  const dayEnd = new Date(date + "T00:00:00+08:00");
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const { data: deliveredRows } = await supabase
    .from("delivery_orders")
    .select("id, driver_id, delivery_date, trip_no, delivered_at, points, points_manual")
    .eq("driver_id", user.id)
    .eq("status", "delivered")
    .eq("cancelled", false)
    .gte("delivered_at", `${date}T00:00:00+08:00`)
    .lt("delivered_at", dayEnd.toISOString());
  const day = dayTotals(withTripPoints(deliveredRows ?? [])).get(date) ?? { delivered: 0, points: 0, missingPoints: 0 };

  const { data } = await supabase
    .from("delivery_orders")
    .select("*, do_items(id, item_code, description, uom, qty)")
    .eq("driver_id", user.id)
    .eq("delivery_date", date)
    .eq("cancelled", false)
    .order("trip_no")
    .order("trip_seq")
    .order("created_at");
  // In the order the office planned on the Driver status page: trip by trip, stop by stop.
  // Points shown per DO follow the trip rule (one full-points DO per trip, the rest 1).
  const jobs = withTripPoints((data ?? []) as DeliveryOrder[]);
  const done = jobs.filter((j) => j.status === "delivered").length;
  const trips: { no: number; jobs: typeof jobs }[] = [];
  for (const j of jobs) {
    if (trips.at(-1)?.no === j.trip_no) trips.at(-1)!.jobs.push(j);
    else trips.push({ no: j.trip_no, jobs: [j] });
  }

  return (
    <div className="mx-auto min-h-dvh max-w-lg bg-white pb-10">
      {/* The office may add, move or re-order this driver's DOs at any time. */}
      <RealtimeRefresh table="delivery_orders" filter={`driver_id=eq.${user.id}`} everyMs={60_000} />
      <header className="sticky top-0 z-10 bg-black px-4 pb-5 pt-4 text-white">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/kowhock-logo.png" alt="Kow Hock" width={400} height={278} className="h-12 w-auto shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-white/70">{t.hi(profile.full_name)}</p>
              <h1 className="truncate text-lg font-semibold">{isToday ? `${t.today} · ${dayMonth(date)}` : dayMonth(date)}</h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            <LangToggle lang={lang} />
            {profile.role !== "driver" && <Link href="/deliveries" className="text-white/80">{t.back}</Link>}
            <form action={signOut}><button className="text-white/80">{t.signOut}</button></form>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <Link href={`/driver?date=${shiftDate(date, -1)}`} className="rounded-lg bg-white/15 px-3 py-1.5" aria-label={t.prevDay}>‹</Link>
          <form className="flex flex-1 items-center gap-2">
            <input
              type="date"
              name="date"
              defaultValue={date}
              className="min-w-0 flex-1 rounded-lg bg-white/15 px-2 py-1.5 text-white [color-scheme:dark]"
            />
            <button className="rounded-lg bg-white/15 px-3 py-1.5">{t.go}</button>
          </form>
          <Link href={`/driver?date=${shiftDate(date, 1)}`} className="rounded-lg bg-white/15 px-3 py-1.5" aria-label={t.nextDay}>›</Link>
          {!isToday && <Link href="/driver" className="rounded-lg bg-kh-yellow px-3 py-1.5 font-medium text-black">{t.today}</Link>}
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-sm">
            <span>{t.doneOf(done, jobs.length)}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-kh-yellow transition-all" style={{ width: `${jobs.length ? (done / jobs.length) * 100 : 0}%` }} />
          </div>
        </div>
      </header>

      <div className="space-y-3 px-4 pt-4">
        <CommissionBar lang={lang} date={date} isToday={isToday} delivered={day.delivered} points={day.points} missingPoints={day.missingPoints} />
        {jobs.length === 0 && (
          <div className="card p-10 text-center text-slate-500">{isToday ? t.noJobsToday : t.noJobsOn(day_(date))}</div>
        )}
        {trips.map(({ no, jobs: trip }, i) => {
          // A trip stays folded while an earlier trip still has DOs to deliver; the driver can tap to open it.
          const waitingOn = trips.slice(0, i).find((x) => x.jobs.some((j) => j.status !== "delivered" && j.status !== "failed"));
          return (
            <details key={no} open={!waitingOn} className="group space-y-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 pt-2 text-sm font-semibold text-slate-600 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-1.5">
                  <span className="text-slate-400 transition-transform group-open:rotate-90" aria-hidden>›</span>
                  {t.trip(no)}
                </span>
                <span className={`font-normal text-slate-400 ${waitingOn ? "hidden group-open:inline" : ""}`}>
                  {t.tripDone(trip.filter((x) => x.status === "delivered").length, trip.length)}
                </span>
                {waitingOn && <span className="font-normal text-slate-400 group-open:hidden">{t.tripLater(waitingOn.no)}</span>}
              </summary>
              {trip.map((j) => (
                <JobCard key={j.id} job={j} driverName={profile.full_name} lang={lang} />
              ))}
            </details>
          );
        })}
      </div>
    </div>
  );
}
