/**
 * The company's branches and how AutoCount names them. Users' profiles.branch
 * and the branch columns on SOs/DOs store the `code`.
 *
 * - accountBook: the AutoCount account book (database) holding this branch's DOs. null = the main "M" book
 *              (AUTOCOUNT_DB_NAME in .env.local), which holds several branches told apart by DO prefix.
 *              A branch with its own book owns every DO and K- invoice read from that book, whatever the number.
 * - doPrefixes: DO numbers start with one of these (GPD-00044524 → GP delivers it)
 * - icbPrefix: inter-company invoices that serve as this branch's DO start with it (M-PT-00000483, K-UT-00000663)
 * - soPrefix:  SO numbers start with it
 * - locations: AutoCount "Sales Location" / "Agent" values that mean this branch
 * - store:     the store's address; delivery distance (and driver points) is measured from here
 * - pin:       the store's exact map pin; when set, distance is measured from it instead of the
 *              address (Google can't find many lot / "Batu" addresses)
 */
export const BRANCHES = [
  {
    code: "GP", name: "Gelang Patah", accountBook: null, doPrefixes: ["GPD"], icbPrefix: "M-GP", soPrefix: "GPS", locations: ["GPS", "GP"],
    store: "Lot 261 Mukim Jelutong, Jalan Ulu Choh, 81550 Gelang Patah, Johor",
    pin: null,
  },
  {
    // TODO: Pandan store address — until it's set, PD deliveries need points keyed in on Driver status.
    code: "PD", name: "Pandan", accountBook: null, doPrefixes: ["PDD"], icbPrefix: "M-PD", soPrefix: "PDS", locations: ["PD", "PDS"],
    store: "Jalan Kangkar Tebrau, Kangkar Tebrau Baru, 81100 Johor Bahru, Johor Darul Ta'zim",
    pin: null,
  },
  {
    code: "KS", name: "Kempas", accountBook: null, doPrefixes: ["KSD"], icbPrefix: "M-KS", soPrefix: "KSS", locations: ["KP", "KS", "KSS"],
    store: "Lot 44565, Jalan Kempas Baru, Kempas Baru, 81300 Johor Bahru, Johor",
    pin: null,
  },
  {
    code: "MS", name: "Masai", accountBook: null, doPrefixes: ["MSD"], icbPrefix: "M-MS", soPrefix: "MSS", locations: ["MS", "MSS"],
    store: "Jalan Besar, Kampung Pertanian, 81750 Pasir Gudang, Johor",
    pin: null,
  },
  {
    code: "PT", name: "Pontian", accountBook: null, doPrefixes: ["PTD"], icbPrefix: "M-PT", soPrefix: "PTS", locations: ["PT", "PTS"],
    store: "Lot 3863, Batu 32, Jalan Johor, 82000 Pontian, Johor, Malaysia",
    pin: { lat: 1.515167, lng: 103.448833 }, // Google Maps pin at the store (1°30'54.6"N 103°26'55.8"E)
  },
  {
    // TODO: soPrefix / locations guessed from the DO prefix (SND) — check against AutoCount.
    code: "SL", name: "Seelong", accountBook: null, doPrefixes: ["SND"], icbPrefix: "M-SN", soPrefix: "SNS", locations: ["SL", "SN", "SNS"],
    store: "Lot 147723, Kg Seelong Jaya, 81400 Senai, Johor Darul Ta'zim",
    pin: null,
  },
  // NB2: a branch of its own, with no store set (so no delivery distance). Has lorries: see LORRY_ONLY_BRANCHES.
  { code: "NB2", name: "NB2", accountBook: null, doPrefixes: ["NBD"], icbPrefix: null, soPrefix: "NBS", locations: ["NB2", "NB"], store: null, pin: null },
  // Branches with their own AutoCount account book (same API and login as the M book).
  // Older DO prefixes seen in the books (DOKKC-, NJDO-, PRD-) are listed too, so they can be linked to special DOs.
  {
    code: "UT", name: "Ulu Tiram", accountBook: "AED_KHTIRAM", doPrefixes: ["UTDO", "DOKKC"], icbPrefix: "K-UT", soPrefix: null, locations: [],
    store: "Lot 413, Batu 13 1/2, JST, 54, Sungai Tiram, 81800 Ulu Tiram, Johor",
    pin: null,
  },
  {
    // short: the label in the Deliveries page's branch filter (the full name is used everywhere else).
    code: "TT", name: "Jaya Mas (Taman Timor)", short: "Jaya Mas (TT)", accountBook: "AED_KHNJ", doPrefixes: ["TTDO", "NJDO"], icbPrefix: "K-TT", soPrefix: null, locations: [],
    store: "PTD 57952, Jalan Timor, Taman Timor, 81300 Johor Bahru, Johor",
    pin: null,
  },
  {
    // Its book's Sales Location is "KS", which in the M book means Kempas — so the code is KSL.
    code: "KSL", name: "Kuala Selangor", accountBook: "AED_KHKS", doPrefixes: ["SLDO"], icbPrefix: null, soPrefix: null, locations: [],
    store: "96RC+P2 Tanjung Karang, Selangor",
    pin: { lat: 3.390087, lng: 101.220078 }, // the plus code 96RC+P2 (near Tanjung Karang)
  },
  {
    code: "PR", name: "Pengerang", accountBook: "AED_KHPGR", doPrefixes: ["PRDO", "PRD"], icbPrefix: "K-PR", soPrefix: null, locations: [],
    store: "PTD 8431, Jalan Teluk Ramunia, Kampung Simon, Teluk Ramunia, 86120 Pengerang, Johor",
    pin: null,
  },
  {
    code: "CG", name: "CG", accountBook: "AED_KHCG", doPrefixes: ["CGDO"], icbPrefix: "K-CG", soPrefix: null, locations: [],
    store: "110, Jalan Dato Sulaiman, Taman Abad, 80250 Johor Bahru, Johor Darul Ta'zim",
    pin: null,
  },
] as const;

/**
 * Branches that run lorries: every branch with a store, plus these store-less ones (NB2 — lorries
 * only; with no store its delivery distance / points stay keyed in by hand).
 */
const LORRY_ONLY_BRANCHES: readonly string[] = ["NB2"];
export const hasLorries = (code: string | null | undefined) =>
  BRANCHES.some((b) => b.code === code && (!!b.store || LORRY_ONLY_BRANCHES.includes(b.code)));
export const LORRY_BRANCHES = BRANCHES.filter((b) => hasLorries(b.code));

const prefixOf = (docNo: string) => docNo.trim().toUpperCase().split("-")[0];

/**
 * Branch that delivers a DO, from its number: "PDD-00045420" → "PD", "M-PT-00000483" (inter-company invoice) → "PT",
 * "K-UT-00000663" → "UT". The sync uses the account book instead for branches with their own book (see accountBook).
 */
export function branchFromDoNo(doNo: string): string | null {
  const no = doNo.trim().toUpperCase();
  const p = prefixOf(no);
  return BRANCHES.find((b) => (b.doPrefixes as readonly string[]).includes(p) || (b.icbPrefix && no.startsWith(`${b.icbPrefix}-`)))?.code ?? null;
}

/** Branch from an AutoCount Sales Location / Agent value ("GPS", "KP", …), else from the SO number. */
export function branchFromLocation(location: string | null | undefined, soNo?: string): string | null {
  const loc = location?.trim().toUpperCase();
  const byLoc = loc ? BRANCHES.find((b) => (b.locations as readonly string[]).includes(loc)) : undefined;
  if (byLoc) return byLoc.code;
  const p = soNo ? prefixOf(soNo) : "";
  return BRANCHES.find((b) => b.soPrefix === p)?.code ?? null;
}

export function storeAddress(code: string | null | undefined): string | null {
  return BRANCHES.find((b) => b.code === code)?.store ?? null;
}

export function branchName(code: string | null | undefined): string {
  return BRANCHES.find((b) => b.code === code)?.name ?? code ?? "";
}

/**
 * A user's branches. profiles.branch holds one code ("KS") or several ("KS,MS"),
 * set by an admin on the Users page.
 */
export function userBranches(branch: string | null | undefined): string[] {
  return (branch ?? "").split(",").map((b) => b.trim().toUpperCase()).filter(Boolean);
}

/**
 * Which branch a staff page shows. No ?branch= in the URL → the user's own
 * branch (all of theirs when they have several: returns ""); ?branch=all → every
 * branch (returns ""); otherwise that branch.
 */
export function pickBranch(param: string | undefined, own: string | null): string {
  if (param === undefined) {
    const mine = userBranches(own);
    return mine.length === 1 ? mine[0] : "";
  }
  return param === "all" ? "" : param;
}

/**
 * Only the delivering branch plans a DO (driver, trip, date), plus the branch it was
 * handed over to (`helperBranch`), if any. Staff without a branch (e.g. head office)
 * can plan any DO, and so can anyone for a DO with no branch.
 */
export function canPlan(userBranch: string | null | undefined, doBranch: string | null | undefined, helperBranch?: string | null): boolean {
  const mine = userBranches(userBranch);
  return !mine.length || !doBranch || mine.includes(doBranch) || (!!helperBranch && mine.includes(helperBranch));
}

/**
 * Dispatchers with branches only ever see those: DOs they deliver, plus DOs
 * their agents sold that another branch delivers. Admins (and staff without
 * a branch) see every branch. Returns the branches they're kept to, or null.
 */
export function lockedBranches(profile: { role: string; branch: string | null }): string[] | null {
  const mine = userBranches(profile.branch);
  return profile.role === "dispatcher" && mine.length ? mine : null;
}

/**
 * pickBranch, kept inside a dispatcher's branches: one of theirs, or "" for all
 * of theirs (the page then filters on lockedBranches).
 */
export function pageBranch(param: string | undefined, profile: { role: string; branch: string | null }): string {
  const locked = lockedBranches(profile);
  const picked = pickBranch(param, profile.branch);
  if (!locked) return picked;
  if (locked.length === 1) return locked[0];
  return locked.includes(picked) ? picked : "";
}

/** The branch a lorry / special DO is saved under: dispatchers only get one of theirs (the one picked, else their first). */
export function branchToSave(profile: { role: string; branch: string | null }, picked: string | null): string | null {
  const locked = lockedBranches(profile);
  if (!locked) return picked;
  return picked && locked.includes(picked) ? picked : locked[0];
}

/** PostgREST filter for "one of these branches delivers it, sold it or is helping deliver it". */
export const deliveredOrSoldBy = (branches: string | string[]) => {
  const list = ([] as string[]).concat(branches).join(",");
  return `branch.in.(${list}),sales_branch.in.(${list}),helper_branch.in.(${list})`;
};

/**
 * Drivers a DO's branch can pick: that branch's own (and the helping branch's, when handed
 * over). Everyone when neither has drivers set up yet, or the DO has no branch.
 */
export function driversForBranch<D extends { branch: string | null }>(drivers: D[], ...branches: (string | null | undefined)[]): D[] {
  const wanted = branches.filter((b): b is string => !!b);
  const own = drivers.filter((d) => wanted.some((b) => userBranches(d.branch).includes(b)));
  return own.length ? own : drivers;
}
