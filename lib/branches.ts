/**
 * The company's branches and how AutoCount names them. Users' profiles.branch
 * and the branch columns on SOs/DOs store the `code`.
 *
 * - doPrefix:  DO numbers start with it (GPD-00044524 → GP delivers it)
 * - soPrefix:  SO numbers start with it
 * - locations: AutoCount "Sales Location" / "Agent" values that mean this branch
 * - store:     the store's address; delivery distance (and driver points) is measured from here
 */
export const BRANCHES = [
  {
    code: "GP", name: "Gelang Patah", doPrefix: "GPD", soPrefix: "GPS", locations: ["GPS", "GP"],
    store: "Lot 261 Mukim Jelutong, Jalan Ulu Choh, 81550 Gelang Patah, Johor",
  },
  {
    // TODO: Pandan store address — until it's set, PD deliveries need points keyed in on Driver status.
    code: "PD", name: "Pandan", doPrefix: "PDD", soPrefix: "PDS", locations: ["PD", "PDS"],
    store: "Jalan Kangkar Tebrau, Kangkar Tebrau Baru, 81100 Johor Bahru, Johor Darul Ta'zim",
  },
  {
    code: "KS", name: "Kempas", doPrefix: "KSD", soPrefix: "KSS", locations: ["KP", "KS", "KSS"],
    store: "Lot 44565, Jalan Kempas Baru, Kempas Baru, 81300 Johor Bahru, Johor",
  },
  {
    code: "MS", name: "Masai", doPrefix: "MSD", soPrefix: "MSS", locations: ["MS", "MSS"],
    store: "Jalan Besar, Kampung Pertanian, 81750 Pasir Gudang, Johor",
  },
  {
    code: "PT", name: "Pontian", doPrefix: "PTD", soPrefix: "PTS", locations: ["PT", "PTS"],
    store: "J46, Jalan Ulu Pulai, Kampung Parit Kassim, 82000 Pontian, Johor",
  },
  {
    // TODO: soPrefix / locations guessed from the DO prefix (SND) — check against AutoCount.
    code: "SL", name: "Seelong", doPrefix: "SND", soPrefix: "SNS", locations: ["SL", "SN", "SNS"],
    store: "Lot 147723, Kg Seelong Jaya, 81400 Senai, Johor Darul Ta'zim",
  },
  // Delivered by the supplier; kept so the selling branch can still follow it.
  { code: "NB2", name: "NB2 (supplier delivery)", doPrefix: "NBD", soPrefix: "NBS", locations: ["NB2", "NB"], store: null },
] as const;

const prefixOf = (docNo: string) => docNo.trim().toUpperCase().split("-")[0];

/** Branch that delivers a DO, from its number: "PDD-00045420" → "PD". */
export function branchFromDoNo(doNo: string): string | null {
  const p = prefixOf(doNo);
  return BRANCHES.find((b) => b.doPrefix === p)?.code ?? null;
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
 * Only the delivering branch plans a DO (driver, trip, date). Staff without a
 * branch (e.g. head office) can plan any DO, and so can anyone for a DO with no branch.
 */
export function canPlan(userBranch: string | null | undefined, doBranch: string | null | undefined): boolean {
  const mine = userBranches(userBranch);
  return !mine.length || !doBranch || mine.includes(doBranch);
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

/** PostgREST filter for "one of these branches delivers it or sold it". */
export const deliveredOrSoldBy = (branches: string | string[]) => {
  const list = ([] as string[]).concat(branches).join(",");
  return `branch.in.(${list}),sales_branch.in.(${list})`;
};
