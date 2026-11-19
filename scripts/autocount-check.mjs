//   npm run autocount:check
// Logs in to every account book and reads 2 DOs from each. With one book named, prints them exactly as AutoCount sends them.
const env = process.env;
const missing = ["AUTOCOUNT_API_URL", "AUTOCOUNT_DB_NAME", "AUTOCOUNT_USER", "AUTOCOUNT_PASSWORD"].filter((k) => !env[k]);
if (missing.length) {
  console.error(`Fill these in .env.local first: ${missing.join(", ")}`);
  process.exit(1);
}

const base = env.AUTOCOUNT_API_URL.replace(/\/+$/, "");
const headers = (token) => ({
  "Content-Type": "application/json",
  ...(token && { Authorization: `Bearer ${token}` }),
  ...(env.AUTOCOUNT_CF_ACCESS_CLIENT_ID && { "CF-Access-Client-Id": env.AUTOCOUNT_CF_ACCESS_CLIENT_ID }),
  ...(env.AUTOCOUNT_CF_ACCESS_CLIENT_SECRET && { "CF-Access-Client-Secret": env.AUTOCOUNT_CF_ACCESS_CLIENT_SECRET }),
});
const post = async (path, body, token) => {
  const res = await fetch(base + path, { method: "POST", headers: headers(token), body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
};

// Every account book: the M book, plus each branch's own book (accountBook in lib/branches.ts).
// Only these: npm run autocount:check -- AED_KHCG AED_KHNJ
import { readFileSync } from "node:fs";
const own = [...readFileSync(new URL("../lib/branches.ts", import.meta.url), "utf8").matchAll(/accountBook: "([^"]+)"/g)].map((m) => m[1]);
const dbs = process.argv.slice(2).length ? process.argv.slice(2) : [env.AUTOCOUNT_DB_NAME, ...own];

let failed = 0;
for (const db of dbs) {
  try {
    const login = await post("/api/auth/login", { DatabaseName: db, UserLogin: env.AUTOCOUNT_USER, UserPassword: env.AUTOCOUNT_PASSWORD });
    const token = typeof login === "string" ? login
      : login?.token ?? login?.Token ?? login?.accessToken ?? login?.AccessToken ?? login?.data?.token ?? login?.Data?.Token;
    if (!token) throw new Error(`logged in, but no token in this reply: ${JSON.stringify(login)}`);
    const data = await post("/api/deliveryorder/select", { DocNo: [], RecordCount: 1, Limit: 2 }, token);
    const list = Object.values(data?.SdkResult ?? {}).find(Array.isArray) ?? [];
    console.log(`OK   ${db}: logged in, DOs read: ${list.map((d) => d.DocNo).join(", ") || "(none)"}`);
    if (dbs.length === 1) console.log(JSON.stringify(data, null, 2).slice(0, 6000));
  } catch (e) {
    failed++;
    console.log(`FAIL ${db}: ${e instanceof Error ? e.message : e}`);
  }
}
process.exit(failed ? 1 : 0);
