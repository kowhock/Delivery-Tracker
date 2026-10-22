//   npm run autocount:check
// Logs in, then prints 2 delivery orders exactly as AutoCount sends them.
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

const login = await post("/api/auth/login", {
  DatabaseName: env.AUTOCOUNT_DB_NAME,
  UserLogin: env.AUTOCOUNT_USER,
  UserPassword: env.AUTOCOUNT_PASSWORD,
});
const token = typeof login === "string" ? login
  : login?.token ?? login?.Token ?? login?.accessToken ?? login?.AccessToken ?? login?.data?.token ?? login?.Data?.Token;
if (!token) {
  console.log("Logged in, but couldn't find the token in this reply:\n", JSON.stringify(login, null, 2));
  process.exit(1);
}
console.log(`YAYYY! Logged in to ${env.AUTOCOUNT_DB_NAME}`);

for (const what of ["deliveryorder"]) {
  const data = await post(`/api/${what}/select`, { DocNo: [], RecordCount: 1, Limit: 2 }, token);
  console.log(`\n----- ${what} -----\n${JSON.stringify(data, null, 2).slice(0, 6000)}`);
}
