"use client";

import { useRouter } from "next/navigation";
import { LANG_COOKIE, type Lang } from "@/lib/i18n";

/** EN / BM switch for the driver view; remembered on this phone for a year. */
export function LangToggle({ lang }: { lang: Lang }) {
  const router = useRouter();
  const pick = (l: Lang) => {
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  return (
    <div className="flex overflow-hidden rounded-lg bg-white/15 text-xs font-semibold" role="group" aria-label="Language">
      {(["en", "ms"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => pick(l)}
          aria-pressed={lang === l}
          className={`px-2.5 py-1 ${lang === l ? "bg-white text-black" : "text-white/80"}`}
        >
          {l === "en" ? "EN" : "BM"}
        </button>
      ))}
    </div>
  );
}
