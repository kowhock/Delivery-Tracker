# KH Delivery

KH Delivery is a web app for Kow Hock that tracks every delivery order from AutoCount to the customer's door.
Delivery orders sync from AutoCount every 5 minutes. Office staff plan routes and assign drivers and lorries.
Drivers use a phone app to navigate, mark jobs delivered with a photo, and the customer automatically gets a
WhatsApp confirmation. It also works out each driver's points and daily commission, and produces trip forms for payroll.

Built with Next.js, Supabase and Tailwind.

## What's inside

| Page | Who | What it does |
|---|---|---|
| `/deliveries` | office | Board of DOs by status (today by default), assign drivers, updates live |
| `/drivers` | office | Driver status: each driver's orders from date to date, split into trips; drag orders to plan trips. Opens on your own branch's drivers; switch branch with the dropdown |
| `/lorries` | office | Each lorry's driver and what it's doing today; change driver (asks first if the lorry or driver is taken), book maintenance, history |
| `/trip-form` | office | A driver's daily (one day) or monthly (date range) trip form with points and commission; PDF via print, or Excel. A DO the driver didn't mark in the app can be typed into an empty box and saved to that day |
| `/outstanding` | office | Notes on DOs that still need something done (CN, edit DO, …), until cleared |
| `/orders` | admins | SO list with search, status and date filters (SOs aren't synced from the API yet — see below) |
| `/orders/[id]` | admins | SO detail with AutoCount fields, its DOs (one SO can have many), POD photos, timeline |
| `/driver` | drivers | Phone view: today's jobs, Waze/Maps/Call, start → delivered with photo, or failed with reason, WhatsApp buttons |

Roles: **admin** sees and plans everything. **dispatcher** (office staff) with branches set on their
profile (`KS` or `KS,MS`) sees only those branches and plans only DOs their branches deliver; without a
branch they see everything. **driver** only sees their own jobs.

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
   Open http://localhost:3000 and sign in. DOs arrive from the AutoCount sync (below).

## Deploy

Push to GitHub → import the repo on [vercel.com](https://vercel.com) → add the env variables from `.env.example`
(not the AutoCount or sync ones, those are only for the office PC) → Deploy.
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

## How data gets in

The AutoCount sync (`scripts/autocount-sync.ts`) reads two kinds of documents and saves both as DOs
through `importAcDeliveryOrders()` in `lib/autocount.ts`:
- **Delivery orders** (`deliveryorder/select`): GPD-, PDD-, KSD-… The prefix is the delivering branch.
- **Inter-company invoices** (`invoice/select`): only Doc. Nos starting with `M-` (`M-PT-00000483` is a
  PT delivery). Between the group's companies the branches deliver on these instead of a DO. Every other invoice is ignored.

Rules:
- Matched by Doc. No., so syncing again updates AutoCount's fields but never the driver, trip,
  status or delivery date set in this app. `doc_date` keeps AutoCount's Doc Date.
- Branches: DO prefix / `M-<branch>` = delivering branch, Sales Location = agent's branch. Mapping in `lib/branches.ts`.
- One-time backfill: `npm run autocount:sync -- --days 14` (goes one day at a time, because the API slows
  down on long results; days that fail are listed at the end so they can be run again).

What the IPS AutoCount API doesn't send (asked for; the app fills them in once it does):
- item lines on invoices (`M-` DOs have no items), created time and created user, Transfer From / To
  (so SO ↔ DO links and SOs aren't synced yet), and the ICB fields.

`importAcSalesOrders()` is kept for the SO sync (`salesorder/select`) still to be built.

## Things to customise

- WhatsApp message wording: `lib/whatsapp.ts`
- Failure reasons for drivers: `FAIL_REASONS` in `components/JobCard.tsx`
- Accent colour: `--color-brand-*` in `app/globals.css`
- Special DO numbering (`SDO-000001`): the `do_no` default in `supabase/schema.sql`

## Development

Before every commit, run the same checks GitHub runs on every push (`.github/workflows/ci.yml`):
```bash
npm run typecheck && npm test && npm run build
```
- Business rules live in `lib/` with tests next to them (`*.test.ts`); server actions are in `app/actions/`, one file per area.
- Database changes: write them in `supabase/upgrade.sql`, run it in Supabase → SQL Editor, copy them into
  `schema.sql`, then empty `upgrade.sql` (steps at the top of that file). If the change goes with sync changes,
  run the SQL **before** the office PC pulls the new code.
- Commit messages start with what kind of change it is: `feat:`, `fix:`, `ui:`, `api:`, `refactor:`, `docs:`, `chore:`.

## Next ideas

- Sales order sync from the API (`salesorder/select`)
- Reports: on-time rate per driver, failed deliveries by reason
- An alert when the office PC sync stops (`sync_status` older than ~15 minutes)
