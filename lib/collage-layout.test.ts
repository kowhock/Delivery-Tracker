import { describe, expect, it } from "vitest";
import { COLLAGE_WIDTH, collageLayout, deliveryPhotos } from "./collage-layout";

describe("collageLayout", () => {
  it.each([1, 2, 3, 4, 5, 6])("keeps %i photo(s) inside the picture without overlapping", (n) => {
    const { width, height, cells } = collageLayout(n);
    expect(width).toBe(COLLAGE_WIDTH);
    expect(cells).toHaveLength(n);
    for (const c of cells) {
      expect(c.left).toBeGreaterThanOrEqual(0);
      expect(c.top).toBeGreaterThanOrEqual(0);
      expect(c.left + c.width).toBeLessThanOrEqual(width);
      expect(c.top + c.height).toBeLessThanOrEqual(height);
    }
    for (const a of cells)
      for (const b of cells)
        if (a !== b) expect(a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top).toBe(true);
  });

  it("uses two columns and puts an odd fifth photo in the middle", () => {
    const five = collageLayout(5).cells;
    expect(five[4].left + five[4].width / 2).toBeCloseTo(COLLAGE_WIDTH / 2, -1);
    expect(new Set(collageLayout(6).cells.map((c) => c.left)).size).toBe(2);
  });

  it("never goes past 6 photos", () => {
    expect(collageLayout(9).cells).toHaveLength(6);
  });
});

describe("deliveryPhotos", () => {
  it("takes only this delivery's photos, in the order they were taken", () => {
    const names = ["1700-10.jpg", "1700-2.jpg", "1700-0.jpg", "1700-1.jpg", "1600-0.jpg", "notes.txt"];
    expect(deliveryPhotos(names, "abc/1700-0.jpg")).toEqual(["1700-0.jpg", "1700-1.jpg", "1700-2.jpg", "1700-10.jpg"]);
  });

  it("falls back to the first photo when the folder can't be read", () => {
    expect(deliveryPhotos([], "abc/1700-0.jpg")).toEqual(["1700-0.jpg"]);
  });
});
