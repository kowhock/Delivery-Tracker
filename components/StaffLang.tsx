"use client";

import { createContext, useContext } from "react";
import { useRouter } from "next/navigation";
import { STAFF_DICT, STAFF_LANG_COOKIE, type StaffLang } from "@/lib/i18n-staff";

const LangContext = createContext<StaffLang>("en");

/** Set once in the staff layout; client components read the words with useStaffT(). */
export function StaffLangProvider({ lang, children }: { lang: StaffLang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

/** The staff screens' words (lib/i18n-staff.ts). English outside the staff layout (e.g. the driver app). */
export const useStaffT = () => STAFF_DICT[useContext(LangContext)];

/** EN / 中文 switch in the top bar; remembered on this device for a year. */
export function StaffLangToggle() {
  const lang = useContext(LangContext);
  const router = useRouter();
  const pick = (l: StaffLang) => {
    if (l === lang) return;
    document.cookie = `${STAFF_LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs font-semibold" role="group" aria-label={STAFF_DICT[lang].language}>
      {(["en", "zh"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => pick(l)}
          aria-pressed={lang === l}
          className={`px-2 py-1 ${lang === l ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"}`}
        >
          {l === "en" ? "EN" : "中文"}
        </button>
      ))}
    </div>
  );
}
