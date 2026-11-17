/**
 * Where each photo goes in the WhatsApp collage (lib/wa-collage.ts). Driver photos are portrait, so
 * cells are 3:4 and there are at most 2 columns, keeping each photo as wide as possible:
 *   1 → as is · 2 → side by side · 3 → 2, then one centred · 4 → 2 × 2
 *   5 → 2, 2, then one centred · 6 → 2 × 3
 * Every box is the same size, so no photo is left floating in a stretched box.
 * Photos are fitted inside their cell (never cropped or stretched), on white.
 */
export const COLLAGE_MAX = 6;
export const COLLAGE_WIDTH = 2000;
const GAP = 16;

export type Cell = { left: number; top: number; width: number; height: number };

export function collageLayout(count: number): { width: number; height: number; cells: Cell[] } {
  const n = Math.max(1, Math.min(count, COLLAGE_MAX));
  if (n === 1) {
    const w = COLLAGE_WIDTH - 2 * GAP;
    const h = Math.round((w * 4) / 3);
    return { width: COLLAGE_WIDTH, height: h + 2 * GAP, cells: [{ left: GAP, top: GAP, width: w, height: h }] };
  }
  const cw = Math.floor((COLLAGE_WIDTH - 3 * GAP) / 2);
  const ch = Math.round((cw * 4) / 3);
  const col = (c: number) => GAP + c * (cw + GAP);
  const row = (r: number) => GAP + r * (ch + GAP);

  const cells: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / 2);
    // An odd last photo (3 or 5) sits centred on its own row.
    const alone = i === n - 1 && n % 2 === 1;
    cells.push({ left: alone ? Math.round((COLLAGE_WIDTH - cw) / 2) : col(i % 2), top: row(r), width: cw, height: ch });
  }
  return { width: COLLAGE_WIDTH, height: row(Math.ceil(n / 2)), cells };
}

/**
 * The photos of one delivery, in the order the driver took them: the files saved with the same
 * time stamp as the DO's first photo ("<time>-<n>.jpg", see components/JobCard.tsx).
 */
export function deliveryPhotos(names: string[], firstPath: string): string[] {
  const first = firstPath.split("/").pop() ?? "";
  const stamp = first.split("-")[0];
  const num = (name: string) => Number(name.slice(stamp.length + 1, -4)) || 0;
  const mine = names.filter((n) => n.endsWith(".jpg") && n.startsWith(`${stamp}-`)).sort((a, b) => num(a) - num(b));
  return mine.length ? mine : [first];
}
