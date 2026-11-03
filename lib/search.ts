/** Lower case, single spaces, trimmed: so "  Taman   NUSA " matches "taman nusa". */
export const normalise = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** A DO matches when its DO no., customer name, address or typed map address contains the search text. */
export function doMatches(
  j: { do_no: string; customer_name: string; address: string | null; map_address?: string | null },
  search: string
): boolean {
  const term = normalise(search);
  if (!term) return true;
  return [j.do_no, j.customer_name, j.address, j.map_address].some((v) => !!v && normalise(v).includes(term));
}
