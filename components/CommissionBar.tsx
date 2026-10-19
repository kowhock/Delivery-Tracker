"use client";

import { useEffect, useMemo, useState } from "react";
import { FAR_KM, FAR_POINTS, NEAR_POINTS, POINTS_TARGET, RM_PER_POINT, commissionForDay } from "@/lib/commission";
import { DICT, type Lang } from "@/lib/i18n";

const CONFETTI = ["🎉", "💰", "⭐", "🎊", "💵", "✨"];

/**
 * Daily commission progress for the driver: a little lorry drives toward the
 * POINTS_TARGET flag (worth RM_PER_POINT); every point after that in a day earns RM_PER_POINT more.
 */
export function CommissionBar({
  lang = "en",
  date,
  isToday,
  delivered,
  points,
  missingPoints,
}: {
  lang?: Lang;
  date: string;
  isToday: boolean;
  delivered: number;
  points: number;
  missingPoints: number;
}) {
  const t = DICT[lang];
  const earned = commissionForDay(points);
  const unlocked = points >= POINTS_TARGET;
  const steps = Math.min(points, POINTS_TARGET);
  const pct = (steps / POINTS_TARGET) * 100;
  const left = POINTS_TARGET - points;

  const [cheer, setCheer] = useState<string | null>(null);
  const [jumping, setJumping] = useState(false);
  const [party, setParty] = useState(false);
  const [showRules, setShowRules] = useState(false);

  // Confetti on reaching the target and on every RM after it (remembered for this browser session).
  useEffect(() => {
    if (!isToday || !unlocked) return;
    const key = `commission-party-${date}`;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(key) || 0);
    } catch {}
    if (last >= points) return;
    try {
      sessionStorage.setItem(key, String(points));
    } catch {}
    setParty(true);
    setCheer(earned ? t.partyEarned(earned) : t.partyTarget(POINTS_TARGET, RM_PER_POINT));
    const timer = setTimeout(() => setParty(false), 1600);
    return () => clearTimeout(timer);
  }, [isToday, unlocked, points, date, earned, t]);

  useEffect(() => {
    if (!cheer) return;
    const timer = setTimeout(() => setCheer(null), 1800);
    return () => clearTimeout(timer);
  }, [cheer]);

  const confetti = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        icon: CONFETTI[i % CONFETTI.length],
        left: 5 + ((i * 53) % 90),
        dx: `${((i * 37) % 80) - 40}px`,
        rot: `${((i * 97) % 720) - 360}deg`,
        delay: (i % 6) * 0.06,
      })),
    []
  );

  const honk = () => {
    setCheer(t.cheers[Math.floor(Math.random() * t.cheers.length)]);
    setJumping(false);
    requestAnimationFrame(() => setJumping(true));
  };

  const message = !isToday
    ? t.pastDay(delivered, points, earned)
    : points === 0
      ? t.letsGo(POINTS_TARGET, RM_PER_POINT)
      : unlocked
        ? earned
          ? t.unlockedEarned(earned, RM_PER_POINT)
          : t.unlockedTarget(POINTS_TARGET, RM_PER_POINT)
        : left === 1
          ? t.oneMore(RM_PER_POINT)
          : t.moreToGo(left, RM_PER_POINT);

  return (
    <section className="card relative overflow-hidden p-4">
      {party && (
        <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
          {confetti.map((c, i) => (
            <span
              key={i}
              className="confetti absolute top-0 text-lg"
              style={{ left: `${c.left}%`, animationDelay: `${c.delay}s`, ["--dx" as string]: c.dx, ["--rot" as string]: c.rot }}
            >
              {c.icon}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {isToday ? t.todaysCommission : t.thatDaysCommission}
          </p>
          <p key={message} className="pop-in mt-0.5 text-base font-semibold leading-snug text-slate-900">{message}</p>
        </div>
        <div className="shrink-0 rounded-xl bg-emerald-50 px-3 py-1.5 text-right">
          <p className="text-[11px] text-emerald-700">{t.earned}</p>
          <p key={earned} className="pop-in text-lg font-bold tabular-nums text-emerald-700">RM {earned}</p>
        </div>
      </div>

      {/* The road */}
      <div className="relative mt-3 h-16 select-none">
        <div className="absolute inset-x-0 bottom-3 h-3 rounded-full bg-slate-100" />
        <div
          className="absolute bottom-3 left-0 h-3 rounded-full bg-gradient-to-r from-amber-400 to-emerald-500 transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
        {Array.from({ length: POINTS_TARGET }, (_, i) => {
          const reached = i < steps;
          return (
            <span
              key={i}
              className={`absolute bottom-2 grid size-5 -translate-x-1/2 place-items-center rounded-full text-[10px] font-bold ring-2 ring-white transition-colors ${
                reached ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500"
              }`}
              style={{ left: `${((i + 1) / POINTS_TARGET) * 100}%` }}
              title={t.point(i + 1)}
            >
              {reached ? "✓" : i + 1}
            </span>
          );
        })}
        <span className="absolute right-0 top-0 flex items-center gap-1 text-xs font-semibold text-emerald-700" aria-hidden>
          {unlocked ? `RM ${earned}` : t.pts(POINTS_TARGET)} <span className="text-lg">🏁</span>
        </span>

        {/* The lorry */}
        <button
          type="button"
          onClick={honk}
          onAnimationEnd={() => setJumping(false)}
          aria-label={t.tapLorry}
          className="absolute bottom-7 -translate-x-1/2 transition-[left] duration-700 ease-out"
          style={{ left: `${Math.min(Math.max(pct, 6), unlocked ? 78 : 86)}%` }}
        >
          {points > 0 && !unlocked && isToday && (
            <span className="dust-puff absolute -left-3 bottom-0 text-xs" aria-hidden>💨</span>
          )}
          <span className={`block ${jumping ? "lorry-jump" : isToday ? "lorry-bob" : ""}`}>
            <Lorry moving={isToday && !unlocked} />
          </span>
          {cheer && (
            <span className="pop-in absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white shadow">
              {cheer}
            </span>
          )}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {/* <span className="rounded-lg bg-slate-50 px-2.5 py-1">✅ {delivered} delivered</span> */}
        <span className="rounded-lg bg-yellow-50 px-2.5 py-1 text-yellow-900">
          ⭐ {t.pts(points)}
          {missingPoints > 0 && <span className="text-yellow-700/80">{t.pendingPts(missingPoints)}</span>}
        </span>
        <button type="button" onClick={() => setShowRules((s) => !s)} className="ml-auto text-xs text-brand-700">
          {showRules ? t.hide : t.howItWorks}
        </button>
      </div>
      {showRules && (
        <ul className="pop-in mt-2 space-y-1 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
          <li>{t.ruleCommission(POINTS_TARGET, RM_PER_POINT)}</li>
          <li>{t.rulePending}</li>
        </ul>
      )}
    </section>
  );
}

/** A small, friendly lorry facing right. */
function Lorry({ moving }: { moving: boolean }) {
  return (
    <svg width="46" height="30" viewBox="0 0 46 30" aria-hidden>
      <rect x="1" y="4" width="27" height="17" rx="3" className="fill-amber-400" />
      <rect x="4" y="7" width="21" height="3" rx="1.5" className="fill-amber-300" />
      <path d="M28 9h8.5c1 0 1.9.5 2.4 1.3l3.6 5.4c.3.5.5 1 .5 1.6V21H28z" className="fill-brand-600" />
      <path d="M30.5 11.5h5.6l2.8 4.2h-8.4z" className="fill-sky-100" />
      <circle cx="33.5" cy="17.6" r=".9" className="fill-slate-800" />
      <path d="M36 19.2c.6.4 1.4.4 2 0" stroke="#1e293b" strokeWidth=".8" fill="none" strokeLinecap="round" />
      <rect x="1" y="20" width="42" height="3" rx="1.5" className="fill-slate-700" />
      {[9, 34].map((cx) => (
        <g key={cx} className={moving ? "wheel-spin" : ""}>
          <circle cx={cx} cy="24" r="4.5" className="fill-slate-800" />
          <circle cx={cx} cy="24" r="1.8" className="fill-slate-300" />
          <rect x={cx - 0.5} y="20" width="1" height="2.2" className="fill-slate-400" />
        </g>
      ))}
    </svg>
  );
}
