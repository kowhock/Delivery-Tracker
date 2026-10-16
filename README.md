# Delivery Tracker

Tracks sales orders (SO) → delivery orders (DO) → driver → delivered, and lets drivers WhatsApp customers.
Built with Next.js, Supabase and Tailwind. SOs and DOs come from AutoCount (Excel export today, AutoCount API later).

## What's inside

| Page | Who | What it does |
|---|---|---|
| `/deliveries` | office | Board of DOs by status (today by default), assign drivers, updates live |
| `/drivers` | office | Driver status: each driver's orders from date to date, split into trips; drag orders to plan trips. Opens on your own branch's drivers; switch branch with the dropdown |
| `/orders` | office | SO list with search, status and date filters |
| `/orders/[id]` | office | SO detail with AutoCount fields, its DOs (one SO can have many), POD photos, timeline |
| `/import` | office | Upload the AutoCount SO or DO listing (.xlsx/.csv); SO ↔ DO are linked automatically |
| `/driver` | drivers | Phone view: today's jobs, Waze/Maps/Call, start → delivered with photo, or failed with reason, WhatsApp buttons |

Roles: **admin** and **dispatcher** see everything. **driver** only sees their own jobs.

## Setup (about 15 minutes)

1. **Install** [Node.js 20+](https://nodejs.org), then in VS Code's terminal:
   ```bash
   npm install
   ```
2. **Create a Supabase project** at [supabase.com](https://supabase.com) (pick the Singapore region, it's closest to Malaysia).
3. **Create the database**: Supabase → SQL Editor → paste all of `supabase/schema.sql` → Run.
   Changing the database later: put the change in `supabase/upgrade.sql`, run it, copy it into `schema.sql`, then empty `upgrade.sql` (steps at the top of that file).
4. **Connect the app**: copy `.env.example` to `.env.local` and fill in the URL and anon/publishable key from Supabase → Project Settings → API.
5. **Create users**: Supabase → Authentication → Users → Add user → Create new user, tick *Auto Confirm User*.
   For a username login, use the email `<username>@khdelivery.my` (e.g. `ali@khdelivery.my` signs in as `ali`;
   lowercase, no spaces). It's never emailed, so reset forgotten passwords from that same Users page.
   Real emails also work — type the full email at sign-in. Everyone starts as a `driver`. Make yourself admin in the SQL Editor:
   ```sql
   update profiles set role = 'admin', full_name = 'Ying' where id = (select id from auth.users where email = 'you@company.com');
   -- office staff:
   update profiles set role = 'dispatcher' where id = (select id from auth.users where email = 'staff@company.com');
   -- drivers: just set their display name
   update profiles set full_name = 'Ali' where id = (select id from auth.users where email = 'ali@khdelivery.my');
   ```
6. **Run it**:
   ```bash
   npm run dev
   ```
   Open http://localhost:3000, sign in, go to **Import** and upload the SO and DO listings exported from AutoCount.

## Deploy

Push to GitHub → import the repo on [vercel.com](https://vercel.com) → add the same three env variables → Deploy.
Drivers open the link on their phone and use **Add to Home Screen** (Safari share menu on iPhone, ⋮ menu in Chrome on Android) so it behaves like an app.

## How data gets in (and where AutoCount plugs in later)

Everything goes through `importAcSalesOrders()` / `importAcDeliveryOrders()` in `lib/autocount.ts`,
which take AutoCount documents in the shape defined in `lib/autocount-rows.ts`.
- The Import page parses the Excel export into that shape in the browser and calls them.
- Later, the AutoCount API sync should map its data to the same types and call the same functions.
- Documents are matched by Doc. No.: importing again updates AutoCount's fields but never the driver, trip,
  delivery status or delivery date set in this app.
- SO ↔ DO is many-to-many (`do_sales_orders`), taken from DO "Transfer From" and SO "Transfer To".
  Import order doesn't matter; links fill in when the other side arrives.
- Branches: DO prefix = delivering branch (GPD → GP …), Sales Location = agent's branch. Mapping in `lib/branches.ts`.
- Item lines aren't imported yet: every new SO/DO gets a test item (`TEST_ITEM` in `lib/autocount.ts`).

## Things to customise

- WhatsApp message wording: `lib/whatsapp.ts`
- Failure reasons for drivers: `FAIL_REASONS` in `components/JobCard.tsx`
- Accent colour: `--color-brand-*` in `app/globals.css`
- Special DO numbering (`SDO-000001`): the `do_no` default in `supabase/schema.sql`

## Next ideas

- Automatic WhatsApp messages (Meta WhatsApp Cloud API) instead of tap-to-send buttons
- AutoCount sync script
- Reports: on-time rate per driver, failed deliveries by reason