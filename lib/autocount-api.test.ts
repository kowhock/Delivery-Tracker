import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A fake AutoCount API: login gives a token, deliveryorder/select returns `pages[RecordCount - 1]`.
function fakeAutoCount(pages: Record<string, unknown>[][], opts: { rejectFirstToken?: boolean } = {}) {
  let logins = 0;
  const calls: { path: string; body: { RecordCount: number }; auth?: string }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init.body));
    const auth = (init.headers as Record<string, string>).Authorization;
    calls.push({ path, body, auth });
    if (path === "/api/auth/login") return new Response(JSON.stringify({ token: `t${++logins}` }));
    if (opts.rejectFirstToken && auth === "Bearer t1") return new Response("expired", { status: 401 });
    const list = pages[body.RecordCount - 1] ?? [];
    return new Response(JSON.stringify({ Success: true, SdkResult: { DeliveryOrders: list } }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

const docs = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ DocNo: `GPD-${from + i}` }));

beforeEach(() => {
  vi.resetModules(); // the client keeps its token in module state
  vi.spyOn(console, "log").mockImplementation(() => {});
  process.env.AUTOCOUNT_API_URL = "http://autocount.test/";
  process.env.AUTOCOUNT_DB_NAME = "db";
  process.env.AUTOCOUNT_USER = "u";
  process.env.AUTOCOUNT_PASSWORD = "p";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchAcDeliveryOrders", () => {
  it("keeps every DO when pages overlap (regression: a page starting with a repeat was dropped)", async () => {
    // Page 2 starts with DOs already on page 1, but still has 50 new ones.
    const { calls } = fakeAutoCount([docs(1, 100), docs(51, 150), docs(140, 169)]);
    const { fetchAcDeliveryOrders } = await import("./autocount-api");
    const out = await fetchAcDeliveryOrders({});
    expect(out).toHaveLength(169);
    expect(new Set(out.map((d) => d.doc_no)).size).toBe(169);
    expect(calls.filter((c) => c.path === "/api/deliveryorder/select").map((c) => c.body.RecordCount)).toEqual([1, 2, 3]);
  });

  it("stops when a full page has nothing new", async () => {
    const { calls } = fakeAutoCount([docs(1, 100), docs(1, 100), docs(101, 200)]);
    const { fetchAcDeliveryOrders } = await import("./autocount-api");
    expect(await fetchAcDeliveryOrders({})).toHaveLength(100);
    expect(calls.filter((c) => c.path === "/api/deliveryorder/select")).toHaveLength(2);
  });

  it("logs in again when the token is rejected", async () => {
    const { calls } = fakeAutoCount([docs(1, 3)], { rejectFirstToken: true });
    const { fetchAcDeliveryOrders } = await import("./autocount-api");
    expect(await fetchAcDeliveryOrders({})).toHaveLength(3);
    expect(calls.map((c) => [c.path, c.auth])).toEqual([
      ["/api/auth/login", undefined],
      ["/api/deliveryorder/select", "Bearer t1"],
      ["/api/auth/login", undefined],
      ["/api/deliveryorder/select", "Bearer t2"],
    ]);
  });

  it("maps AutoCount fields to our shape", async () => {
    fakeAutoCount([
      [
        {
          DocNo: " gpd-00044524 ",
          DocDate: "2026-10-27T00:00:00",
          DebtorCode: "300-A001",
          DebtorName: "Ah Seng Hardware",
          SalesLocation: "GPS",
          DeliverAddr1: "No 1, Jalan Ulu Choh",
          DeliverAddr2: " ",
          DeliverAddr3: "81550 Gelang Patah",
          DeliverPhone1: "",
          DeliverContact: "012-3456789",
          FinalTotal: 1234.5,
          Cancelled: "T",
          Details: [{ ItemCode: "CEM-50", Description: "Cement 50kg", UOM: "BAG", Qty: 40 }],
        },
      ],
    ]);
    const { fetchAcDeliveryOrders } = await import("./autocount-api");
    const [d] = await fetchAcDeliveryOrders({});
    expect(d).toMatchObject({
      doc_no: "GPD-00044524",
      date: "2026-10-27",
      debtor_name: "Ah Seng Hardware",
      delivery_address: "No 1, Jalan Ulu Choh, 81550 Gelang Patah",
      phone: "012-3456789",
      total: 1234.5,
      cancelled: true,
      items: [{ item_code: "CEM-50", description: "Cement 50kg", uom: "BAG", qty: 40 }],
    });
  });

  it("refuses to call anything but login, deliveryorder/select and invoice/select", async () => {
    fakeAutoCount([]);
    const { acSelect } = await import("./autocount-api");
    // @ts-expect-error — only "deliveryorder" and "invoice" are allowed by the type too
    await expect(acSelect("salesorder")).rejects.toThrow(/read-only/);
  });
});

describe("fetchAcIcbDeliveryOrders", () => {
  it("keeps only inter-company invoices (M-<branch>-…) and reads them as DOs", async () => {
    const { calls } = fakeAutoCount([
      [
        { DocNo: "M-PT-00000483", SalesAgent: "KH", DebtorName: "KOW HOCK BUILDING MATERIALS (NJ) SDN BHD", FinalTotal: 142.5 },
        { DocNo: "GPI-00031315", SalesAgent: "GPS", DebtorName: "CASH SALES (GELANG PATAH)" },
        { DocNo: "NBI-00032289", SalesAgent: "KH", DebtorName: "KOW HOCK BUILDING MATERIALS (NJ) SDN BHD" },
        { DocNo: "M-XX-00000001", SalesAgent: "KH", DebtorName: "NO SUCH BRANCH" },
        { DocNo: " m-sn-00000005", SalesAgent: "SL", DebtorName: "KOW HOCK BUILDING MATERIALS (CG) SDN BHD" },
      ],
    ]);
    const { fetchAcIcbDeliveryOrders } = await import("./autocount-api");
    const out = await fetchAcIcbDeliveryOrders({});
    expect(out.map((d) => d.doc_no)).toEqual(["M-PT-00000483", "M-SN-00000005"]);
    expect(out[0]).toMatchObject({ debtor_name: "KOW HOCK BUILDING MATERIALS (NJ) SDN BHD", total: 142.5 });
    expect(calls.filter((c) => c.path === "/api/invoice/select")).toHaveLength(1);
  });
});
