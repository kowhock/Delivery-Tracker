# KH Delivery

Tracks sales orders (SO) → delivery orders (DO) → driver → delivered, and lets drivers WhatsApp customers.
Built with Next.js, Supabase and Tailwind. SOs and DOs come from AutoCount (Excel export today, AutoCount API later).

## What's inside

| Page | Who | What it does |
|---|---|---|
| `/deliveries` | office | Board of DOs by status (today by default), assign drivers, updates live |
| `/drivers` | office | Driver status: each driver's orders from date to date, split into trips; drag orders to plan trips. Opens on your own branch's drivers; switch branch with the dropdown |
| `/lorries` | office | Each lorry's driver and what it's doing today; change driver (asks first if the lorry or driver is taken), book maintenance, history |
| `/trip-form` | office | A driver's daily (one day) or monthly (date range) trip form with points and commission; PDF via print, or Excel |
| `/orders` | office | SO list with search, status and date filters |
| `/orders/[id]` | office | SO detail with AutoCount fields, its DOs (one SO can have many), POD photos, timeline |
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

## WhatsApp from the company number (optional)

When a driver taps **Delivered**, the server WhatsApps the customer "delivered" + the POD photo from one
company number (Meta's WhatsApp Cloud API). The driver's card then shows ✓ and the office sees
"WhatsApp sent" (or why it failed, with **Retry**) on the order page. Without these settings, drivers keep
using their own WhatsApp buttons, and they're also the fallback when a send fails.

1. **Number**: a SIM or landline that is *not* on the WhatsApp / WhatsApp Business app (delete that account first if it is).
   Once on the API you can't open it in the WhatsApp app.
2. **Meta Business account**: [business.facebook.com](https://business.facebook.com) → create it with the company's details.
   Later, Business Settings → Security Center → *Start verification* (SSM docs) to lift the 250-customers-a-day limit.
3. **App**: [developers.facebook.com](https://developers.facebook.com) → My Apps → Create app → *Business* type → add **WhatsApp**.
   WhatsApp → API Setup → *Add phone number*, verify it by SMS/call. Copy its **Phone number ID**.
4. **Permanent token**: Business Settings → Users → System users → Add (Admin) → *Assign assets*: the app (full control)
   and the WhatsApp account → *Generate token*, never expires, ticking `whatsapp_business_messaging` and
   `whatsapp_business_management`. (The token on the API Setup page expires in 24 hours: only for testing.)
5. **Template**: WhatsApp Manager → Message templates → Create → category **Utility**, name `delivered_photo`,
   language English. Header: **Image** (upload any sample). Body, e.g.:
   ```
   Hi {{1}}, your order {{2}} has been delivered. Thank you for choosing Kow Hock!
   ```
   {{1}} = customer name, {{2}} = SO (DO) number. Submit and wait for *Active*.
   Optional: the same body with no header as `delivered_text`, for deliveries without a photo.
   For Malay, create it in language Malay and set `WHATSAPP_TEMPLATE_LANG=ms`.
6. **Payment**: WhatsApp Manager → add a card (per message; utility messages cost a few sen in Malaysia).
7. **Settings**: put `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_DELIVERED`
   (and optionally `WHATSAPP_TEMPLATE_DELIVERED_NO_PHOTO`, `WHATSAPP_TEMPLATE_LANG`) in `.env.local` and in Vercel → Settings →
   Environment Variables, then redeploy.

Test: mark a test DO delivered with your own mobile number as its contact phone.

## AutoCount sync (office PC)

The office PC (on the same network as AutoCount) runs `scripts/autocount-sync.bat`, started by Windows Task Scheduler
at startup. Every 5 minutes it copies new and changed DOs from AutoCount into Supabase, and logs to `autocount-sync.log`.
The project is cloned to `C:\kh-delivery`, with its own `.env.local` (not in git, so copy it there by hand).

**Getting new code onto the office PC.** Only needed when the sync changed (`scripts/autocount-sync.ts` or the `lib/` files it uses).
Page changes go live through Vercel and don't need the office PC.

1. On your own computer: commit and push to GitHub.
2. On the office PC, either:
   - **restart the PC** (or Task Scheduler → the sync task → *End*, then *Run*). The `.bat` runs `git pull` and
     `npm install` itself before it starts; or
   - update by hand, then restart the task as above:
     ```bat
     cd C:\kh-delivery
     git pull
     npm install
     ```
3. If the change came with database changes in `supabase/upgrade.sql`, run that in Supabase → SQL Editor **before** step 2.
4. Check `autocount-sync.log`: the newest `===== … starting` block should show the pull and a sync run without errors.

If `git pull` fails (usually because a file was edited on the office PC), run `git status` to see which file,
then `git checkout -- <file>` to throw that edit away and pull again. Task Scheduler doesn't need changing
when the code changes.

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