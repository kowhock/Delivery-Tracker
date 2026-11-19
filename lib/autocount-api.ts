import "server-only";
import type { AcDeliveryOrder } from "./autocount-rows";
import { BRANCHES, branchFromDoNo } from "./branches";

/**
 * READ-ONLY client for the IPS AutoCount API (settings in .env.local).
 * Docs: https://documenter.getpostman.com/view/2726001/2sB3dTu8Vc
 * Every endpoint there is a POST, including insert/update/delete. This client
 * can only reach login, deliveryorder/select and invoice/select, so it can't
 * change AutoCount data or read anything else (sales orders aren't fetched).
 */

const READABLE = ["deliveryorder", "invoice"] as const;
export type AcReadable = (typeof READABLE)[number];

export type AcSelectFilter = {
  DocNo?: string[]; // [] = all
  RecordCount?: number; // page, from 1
  Limit?: number; // max 500
  DateFrom?: string; // "2026/10/01" — From and To go together
  DateTo?: string;
  CreatedTimeFrom?: string;
  CreatedTimeTo?: string;
  LastModifiedFrom?: string;
  LastModifiedTo?: string;
};

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is missing in .env.local`);
  return v;
};

function headers(token?: string) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (process.env.AUTOCOUNT_CF_ACCESS_CLIENT_ID) h["CF-Access-Client-Id"] = process.env.AUTOCOUNT_CF_ACCESS_CLIENT_ID;
  if (process.env.AUTOCOUNT_CF_ACCESS_CLIENT_SECRET) h["CF-Access-Client-Secret"] = process.env.AUTOCOUNT_CF_ACCESS_CLIENT_SECRET;
  return h;
}

async function post(path: string, body: unknown, token?: string) {
  if (!["/api/auth/login", ...READABLE.map((w) => `/api/${w}/select`)].includes(path)) {
    throw new Error(`AutoCount is read-only here: ${path} is not allowed.`);
  }
  const res = await fetch(env("AUTOCOUNT_API_URL").replace(/\/+$/, "") + path, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(300_000),
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`AutoCount ${path}: ${res.status} ${text.slice(0, 300)}`), { status: res.status });
  return text ? JSON.parse(text) : null;
}

/**
 * An AutoCount account book. The main "M" book (AUTOCOUNT_DB_NAME) holds several branches, told apart by
 * DO prefix; the others each belong to one branch (accountBook in lib/branches.ts). Same API and login.
 */
export type AcBook = { db: string; branch: string | null; icbPrefixes: string[] };

export function acBooks(): AcBook[] {
  return [
    { db: env("AUTOCOUNT_DB_NAME"), branch: null, icbPrefixes: ["M-"] },
    ...BRANCHES.filter((b) => b.accountBook).map((b) => ({
      db: b.accountBook!,
      branch: b.code as string,
      icbPrefixes: b.icbPrefix ? [`${b.icbPrefix}-`] : [],
    })),
  ];
}

// Tokens expire daily: keep one per account book, log in again when it's rejected. After the AutoCount API
// restarts, old tokens get 403 "LicenseNotAllowed" instead of 401 — a fresh login fixes that too.
const tokens = new Map<string, string>();

async function login(db: string) {
  const data = await post("/api/auth/login", {
    DatabaseName: db,
    UserLogin: env("AUTOCOUNT_USER"),
    UserPassword: env("AUTOCOUNT_PASSWORD"),
  });
  const t = typeof data === "string" ? data : data?.token ?? data?.Token ?? data?.accessToken ?? data?.AccessToken ?? data?.data?.token ?? data?.Data?.Token;
  if (!t) throw new Error(`AutoCount login (${db}): no token in reply ${JSON.stringify(data).slice(0, 300)}`);
  tokens.set(db, String(t));
  return String(t);
}

/** e.g. acSelect("deliveryorder", { DateFrom: "2026/10/01", DateTo: "2026/10/22" }). `db` defaults to the M book. */
export async function acSelect(what: AcReadable, filter: AcSelectFilter = {}, db = env("AUTOCOUNT_DB_NAME")) {
  if (!READABLE.includes(what)) throw new Error(`AutoCount is read-only here: ${what} is not allowed.`);
  const body = { DocNo: [], RecordCount: 1, Limit: 500, ...filter };
  try {
    return await post(`/api/${what}/select`, body, tokens.get(db) ?? (await login(db)));
  } catch (e) {
    if (![401, 403].includes((e as { status?: number }).status ?? 0)) throw e;
    return post(`/api/${what}/select`, body, await login(db));
  }
}

// ---------- AutoCount API → the same shapes as the Excel import --------

type ApiDoc = Record<string, unknown> & { DocNo: string };

const str = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const joinAddr = (r: ApiDoc) => [r.DeliverAddr1, r.DeliverAddr2, r.DeliverAddr3, r.DeliverAddr4].map(str).filter(Boolean).join(", ") || null;

/** Reads every page. Invoices come slower than DOs: 100 of them can take over 5 minutes, past the timeout. */
async function selectAll(what: AcReadable, filter: AcSelectFilter, db: string, Limit = 100): Promise<ApiDoc[]> {
  const all = new Map<string, ApiDoc>();
  for (let page = 1; ; page++) {
    const t0 = Date.now();
    const data = await acSelect(what, { ...filter, RecordCount: page, Limit }, db);
    if (!data?.Success) throw new Error(`AutoCount ${what} (${db}): ${JSON.stringify(data).slice(0, 300)}`);
    const list = (Object.values(data.SdkResult ?? {}).find(Array.isArray) ?? []) as ApiDoc[];
    // Pages can overlap (AutoCount's order isn't fixed), so keep every DO not seen yet instead of
    // dropping a page whose first DO is a repeat. Stop on a short page, or one with nothing new.
    const fresh = list.filter((d) => !all.has(d.DocNo));
    for (const d of fresh) all.set(d.DocNo, d);
    console.log(`[${db} ${what}] page ${page}: ${list.length} docs, ${fresh.length} new (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    if (list.length < Limit || !fresh.length) break;
  }
  return [...all.values()];
}

const toDo = (r: ApiDoc): AcDeliveryOrder => ({
  doc_no: r.DocNo.trim().toUpperCase(),
  date: str(r.DocDate)?.slice(0, 10) ?? null,
  debtor_code: str(r.DebtorCode),
  debtor_name: str(r.DebtorName),
  sales_location: str(r.SalesLocation),
  delivery_address: joinAddr(r),
  transfer_from: null, // TODO: the API has no "Transfer From" — SO ↔ DO links need it
  transfer_to: null,
  ref: str(r.Ref),
  phone: str(r.DeliverPhone1) ?? str(r.DeliverContact) ?? str(r.Phone1),
  created_user: null,
  total: typeof r.FinalTotal === "number" ? r.FinalTotal : null,
  cancelled: str(r.Cancelled) === "T",
  items: ((r.Details ?? []) as Record<string, unknown>[]).map((i) => ({
    item_code: str(i.ItemCode) ?? "",
    description: str(i.Description),
    uom: str(i.UOM),
    qty: typeof i.Qty === "number" ? i.Qty : 0,
  })),
});

const mainBook = (): AcBook => acBooks()[0];
const tag = (book: AcBook) => (d: AcDeliveryOrder): AcDeliveryOrder => (book.branch ? { ...d, book_branch: book.branch } : d);

export async function fetchAcDeliveryOrders(filter: AcSelectFilter, book: AcBook = mainBook()): Promise<AcDeliveryOrder[]> {
  return (await selectAll("deliveryorder", filter, book.db)).map(toDo).map(tag(book));
}

/**
 * Inter-company deliveries: between the group's own companies the branches skip the DO and
 * deliver on an invoice numbered "M-<branch>-…" in the M book ("M-PT-00000483" = a PT delivery),
 * or "K-<branch>-…" in a branch's own book ("K-UT-00000663" = a Ulu Tiram delivery).
 * Every other invoice (GPI-, CGI-, …) is ignored. A book with no such prefix isn't read at all.
 */
export async function fetchAcIcbDeliveryOrders(filter: AcSelectFilter, book: AcBook = mainBook()): Promise<AcDeliveryOrder[]> {
  if (!book.icbPrefixes.length) return [];
  return (await selectAll("invoice", filter, book.db, 20))
    .filter((r) => {
      const no = r.DocNo.trim().toUpperCase();
      return book.icbPrefixes.some((p) => no.startsWith(p)) && (book.branch || branchFromDoNo(no));
    })
    .map(toDo)
    .map(tag(book));
}
