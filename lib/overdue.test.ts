import { describe, expect, it } from "vitest";
import { daysBetween, lateSince, overdueWindow, unassignedTab } from "./overdue";

const TODAY = "2026-11-19";
const tab = (delivery_date: string, doc_date: string | null, branch: string | null = "TT", from = TODAY, to = TODAY) =>
  unassignedTab({ delivery_date, doc_date, branch }, from, to, TODAY);

describe("unassignedTab, viewing today", () => {
  it("today's DO is New", () => {
    expect(tab(TODAY, TODAY)).toBe("new");
  });

  it("a DO rolled to today from an earlier DO date is Overdue", () => {
    expect(tab(TODAY, "2026-11-16")).toBe("overdue");
    expect(tab(TODAY, "2026-11-16", "KS")).toBe("overdue");
  });

  it("a DO still on its own past day is Overdue", () => {
    expect(tab("2026-11-17", "2026-11-17")).toBe("overdue");
  });

  it("a DO a dispatcher planned for a later day is neither until that day, then Overdue (its DO date has passed)", () => {
    expect(tab("2026-11-21", "2026-11-16")).toBeNull();
    // No "planned" mark is kept, so on its day it looks like any DO whose DO date has passed.
    const planned = { delivery_date: "2026-11-21", doc_date: "2026-11-16", branch: "TT" };
    expect(unassignedTab(planned, "2026-11-21", "2026-11-21", "2026-11-21")).toBe("overdue");
    expect(lateSince(planned, "2026-11-21")).toBe("2026-11-16");
    expect(unassignedTab(planned, "2026-11-22", "2026-11-22", "2026-11-22")).toBe("overdue");
    // A DO planned for a later day whose DO date is that day or later is New on its day.
    expect(unassignedTab({ ...planned, doc_date: "2026-11-21" }, "2026-11-21", "2026-11-21", "2026-11-21")).toBe("new");
  });

  it("special DOs (no DO date) go by their delivery date", () => {
    expect(tab(TODAY, null)).toBe("new");
    expect(tab("2026-11-18", null)).toBe("overdue");
  });

  it("October is hidden from Overdue (OVERDUE_SINCE)", () => {
    expect(tab("2026-10-31", "2026-10-31")).toBeNull();
    expect(tab(TODAY, "2026-10-28")).toBeNull(); // rolled, but its DO date is October
  });

  it("M book branches: for now nothing before 9 Nov; own-book branches from 1 Nov", () => {
    expect(tab("2026-11-09", "2026-11-09", "KS")).toBe("overdue");
    expect(tab("2026-11-08", "2026-11-08", "KS")).toBeNull();
    expect(tab(TODAY, "2026-11-05", "MS")).toBeNull(); // rolled from 5 Nov
    expect(tab("2026-11-08", "2026-11-08", "UT")).toBe("overdue");
    expect(tab("2026-11-02", "2026-11-02", null)).toBeNull(); // no branch = M book
  });

  it("New and Overdue never overlap", () => {
    const days = ["2026-10-25", "2026-11-01", "2026-11-08", "2026-11-12", "2026-11-18", TODAY, "2026-11-20"];
    for (const d of days) for (const doc of [...days, null]) for (const b of ["TT", "KS", null]) {
      const r = tab(d, doc, b);
      expect(["new", "overdue", null]).toContain(r);
    }
  });
});

describe("unassignedTab, viewing a range that includes today", () => {
  it("this week: DOs dated this week are New, last week's Overdue", () => {
    const week = (d: string, doc: string | null) => unassignedTab({ delivery_date: d, doc_date: doc, branch: "TT" }, "2026-11-16", "2026-11-22", TODAY);
    expect(week("2026-11-17", "2026-11-17")).toBe("new");
    expect(week(TODAY, "2026-11-16")).toBe("new");
    expect(week(TODAY, "2026-11-13")).toBe("overdue");
    expect(week("2026-11-14", "2026-11-14")).toBe("overdue");
  });
});

describe("overdueWindow", () => {
  it("is never earlier than 1 Nov (M book: 9 Nov), and reaches back 30 days", () => {
    expect(overdueWindow(TODAY)).toEqual({ overdueFrom: "2026-11-01", mBookFrom: "2026-11-09" });
    // A fixed date, not a rolling 10 days: later on, the M book reaches back the full 30 days like every branch.
    expect(overdueWindow("2026-11-30")).toEqual({ overdueFrom: "2026-11-01", mBookFrom: "2026-11-09" });
    expect(overdueWindow("2026-12-31")).toEqual({ overdueFrom: "2026-12-01", mBookFrom: "2026-12-01" });
  });

  it("an M book DO that becomes overdue later is never hidden", () => {
    expect(unassignedTab({ delivery_date: "2026-11-20", doc_date: "2026-11-20", branch: "KS" }, "2026-12-05", "2026-12-05", "2026-12-05")).toBe("overdue");
  });
});

describe("lateSince / daysBetween", () => {
  it("counts from the DO date for a rolled DO, from the planned day otherwise", () => {
    expect(lateSince({ delivery_date: TODAY, doc_date: "2026-11-16" }, TODAY)).toBe("2026-11-16");
    expect(lateSince({ delivery_date: "2026-11-17", doc_date: "2026-11-10" }, TODAY)).toBe("2026-11-17");
    expect(lateSince({ delivery_date: TODAY, doc_date: TODAY }, TODAY)).toBeNull();
    expect(lateSince({ delivery_date: "2026-11-21", doc_date: "2026-11-16" }, TODAY)).toBeNull();
    expect(daysBetween("2026-11-16", TODAY)).toBe(3);
  });
});
