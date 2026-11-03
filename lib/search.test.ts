import { describe, expect, it } from "vitest";
import { doMatches } from "./search";

const j = { do_no: "GPD-12345", customer_name: "Ah Kow Hardware", address: "12, Jalan NB2 2/2, Taman  Nusa Bestari", map_address: null };

describe("doMatches", () => {
  it("matches customer, address or DO no., any case and spacing", () => {
    expect(doMatches(j, "ah kow")).toBe(true);
    expect(doMatches(j, "TAMAN nusa")).toBe(true);
    expect(doMatches(j, "12345")).toBe(true);
    expect(doMatches(j, "pandan")).toBe(false);
  });
  it("also matches the typed map address; blank matches everything", () => {
    expect(doMatches({ ...j, map_address: "Lot 5 Kempas" }, "kempas")).toBe(true);
    expect(doMatches(j, "   ")).toBe(true);
  });
});
