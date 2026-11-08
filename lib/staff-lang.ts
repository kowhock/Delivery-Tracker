import "server-only";
import { cookies } from "next/headers";
import { STAFF_DICT, STAFF_LANG_COOKIE, toStaffLang } from "./i18n-staff";

/** The staff screens' language (EN / 中文 toggle in the top bar) and its words, for server components. */
export async function getStaffT() {
  const lang = toStaffLang((await cookies()).get(STAFF_LANG_COOKIE)?.value);
  return { lang, t: STAFF_DICT[lang] };
}
