-- =====================================================================
-- KH Delivery — database schema
-- Run this whole file once in Supabase → SQL Editor → New query → Run.
--
-- This is the database as it is now (matches the live project). To change
-- it: write the change in upgrade.sql, run that on Supabase, then make the
-- same change here and empty upgrade.sql again.
-- =====================================================================

-- ---------- Enums ----------------------------------------------------
create type public.user_role as enum ('admin', 'dispatcher', 'driver');
create type public.so_status as enum ('open', 'partial', 'fulfilled', 'cancelled');
create type public.do_status as enum ('pending', 'assigned', 'out_for_delivery', 'delivered', 'failed');

-- ---------- Users / roles --------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  full_name  text not null default '',       -- display name shown in the app
  real_name  text,                           -- real (legal) name, for admin reference only
  phone      text,
  role       public.user_role not null default 'driver',
  branch     text,                           -- GP, PD, …; pages open on this branch first
  lorry_no   text,                           -- number on the driver's lorry, e.g. "93"
  created_at timestamptz not null default now()
);

-- Every new login account gets a profile (role = driver unless set).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'driver')
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_staff() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(public.my_role() in ('admin', 'dispatcher'), false)
$$;

-- ---------- Lorries ----------------------------------------------------
-- Each lorry has at most one driver, and each driver at most one lorry.
-- profiles.lorry_no is kept in step by a trigger (it's shown next to drivers' names).
create table public.lorries (
  id               uuid primary key default gen_random_uuid(),
  lorry_no         text not null unique,       -- number painted on the lorry, e.g. "46"
  plate_no         text,                       -- e.g. "JQN 9833"
  branch           text,
  driver_id        uuid unique references public.profiles on delete set null,
  maintenance_from date,                       -- set = under (or booked for) maintenance from this day
  maintenance_to   date,                       -- expected back; null = not known yet
  maintenance_note text,
  created_at       timestamptz not null default now()
);

-- History: driver changes and maintenance, newest first on the Lorries page.
create table public.lorry_events (
  id         bigint generated always as identity primary key,
  lorry_id   uuid not null references public.lorries on delete cascade,
  note       text not null,
  actor_id   uuid default auth.uid() references public.profiles on delete set null,
  created_at timestamptz not null default now()
);
create index lorry_events_lorry_idx on public.lorry_events (lorry_id, created_at);

create or replace function public.sync_lorry_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles p set lorry_no = (select l.lorry_no from public.lorries l where l.driver_id = p.id)
  where p.id in (old.driver_id, new.driver_id);
  return null;
end $$;

create trigger sync_lorry_no
  after insert or update or delete on public.lorries
  for each row execute function public.sync_lorry_no();

-- ---------- Sales orders (shaped like AutoCount SO) -------------------
create table public.sales_orders (
  id            uuid primary key default gen_random_uuid(),
  so_no         text not null unique,          -- AutoCount DocNo
  so_date       date not null default current_date,
  debtor_code   text,                          -- AutoCount DebtorCode
  customer_name text not null,
  phone         text,
  address       text,                          -- AutoCount Delivery Address 1
  branch        text,                          -- selling branch (from Sales Location), e.g. GP
  sales_location text,                         -- AutoCount Sales Location as exported, e.g. GPS / KP
  agent         text,
  credit_term   text,
  total         numeric(14, 2),
  remarks       text,                          -- AutoCount Remark 1 (delivery instructions)
  transfer_to   text,                          -- AutoCount Transfer To: the DO number(s), as exported
  icb_from_po   text,
  created_user  text,                          -- AutoCount Created User
  ac_created_at timestamptz,                   -- AutoCount Created Time
  status        public.so_status not null default 'open',
  source        text not null default 'manual', -- manual | autocount
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index sales_orders_so_no_ci_key on public.sales_orders (upper(so_no)); -- "SO-001" = "so-001"

create table public.so_items (
  id          uuid primary key default gen_random_uuid(),
  so_id       uuid not null references public.sales_orders on delete cascade,
  line_no     int not null default 1,
  item_code   text not null,
  description text,
  uom         text,
  qty         numeric(12, 2) not null check (qty > 0)
);
create index on public.so_items (so_id);

-- ---------- Delivery orders ------------------------------------------
-- DOs come from AutoCount. Customer/address/phone/remarks are copied onto
-- the DO so drivers never need access to the sales_orders table.
-- AutoCount owns the document fields; the app owns driver/trip/status.
create sequence public.do_no_seq;

create table public.delivery_orders (
  id             uuid primary key default gen_random_uuid(),
  do_no          text not null unique
                 default 'SDO-' || lpad(nextval('public.do_no_seq')::text, 6, '0'), -- special DOs; AutoCount DOs bring their own
  so_id          uuid references public.sales_orders on delete set null, -- first linked SO (for links); all links in do_sales_orders
  so_no          text not null default '',     -- AutoCount Transfer From: the SO number(s), as exported
  customer_name  text not null,
  contact_phone  text,
  address        text,                         -- AutoCount Delivery Address 1
  map_address    text,                         -- typed by the office when Google can't find `address`; null = use address
  remarks        text,                         -- Remark 1 of the linked SO(s)
  delivery_date  date not null default current_date,
  doc_date       date,                         -- AutoCount Doc Date (delivery_date starts as it, the office can move that)
  time_slot      text check (time_slot in ('0845-1100', '1100-1300', '1300-1500', '1500-1700', '1700-1900', '1900-2100')), -- optional estimated delivery window
  branch         text,                         -- delivering branch, from the DO number prefix (GPD → GP)
  sales_branch   text,                         -- agent's branch, from Sales Location; follows the DO too
  helper_branch  text,                         -- another branch helping to deliver it: sees it, picks its driver
  ref            text,                         -- AutoCount Ref. (customer PO etc.)
  total          numeric(14, 2),
  invoice_no     text,                         -- AutoCount Transfer To (invoice)
  special_no     text,                         -- the SDO-… number it had before it was linked to its AutoCount DO
  created_user   text,                         -- AutoCount Created User
  cancelled      boolean not null default false,
  source         text not null default 'manual', -- autocount | special (keyed in by the office)
  instructions   text,                         -- office → driver (special DOs)
  points         int check (points between 0 and 99), -- commission points: 3 if > 20 km, else 2
  points_manual  boolean not null default false, -- keyed in by the office
  distance_km    numeric(7, 2),                -- driving distance from the delivering branch's store
  geo_status     text,                         -- ok | approx | not_found | no_store | no_address | error
  geo_input      text,                         -- the address the distance was worked out from
  geo_address    text,                         -- what Google matched it to
  geo_lat        double precision,             -- where Google put the address (for trip routes)
  geo_lng        double precision,
  own_collection boolean,                      -- O/C (customer collects): null = from "O/C" / "own collect" in remarks/address; true/false = office's pick
  is_oc          boolean generated always as (coalesce(own_collection,
                   coalesce(remarks, '') ~* '(^|[^a-z0-9])(o\s*/\s*c([^a-z0-9]|$)|own\s*collect)'
                   or coalesce(address, '') ~* '(^|[^a-z0-9])(o\s*/\s*c([^a-z0-9]|$)|own\s*collect)')) stored,
  supplier_delivery boolean not null default false, -- the supplier delivers it: no driver, delivered when picked
  driver_id      uuid references public.profiles on delete set null,
  lorry_id       uuid references public.lorries on delete set null, -- lorry it was delivered with (set when delivered)
  trip_no        int not null default 1 check (trip_no > 0), -- which trip of the driver's day
  trip_seq       int not null default 0,                     -- stop order inside the trip
  status         public.do_status not null default 'pending',
  failed_reason  text,
  pod_photo_path text,                         -- proof-of-delivery photo in storage bucket "pod"
  wa_sent_at     timestamptz,                  -- "delivered" WhatsApp sent from the company number (Cloud API)
  wa_error       text,                         -- why the last WhatsApp send failed
  delivered_at   timestamptz,
  created_by     uuid default auth.uid() references public.profiles on delete set null,
  created_at     timestamptz not null default now()
);
create unique index delivery_orders_do_no_ci_key on public.delivery_orders (upper(do_no));
create index on public.delivery_orders (driver_id, delivery_date);
create index on public.delivery_orders (delivery_date, status);
create index on public.delivery_orders (so_id);
create index delivery_orders_branch_idx on public.delivery_orders (branch, delivery_date);
create index delivery_orders_sales_branch_idx on public.delivery_orders (sales_branch, delivery_date);
create index delivery_orders_delivered_idx on public.delivery_orders (driver_id, delivered_at) where status = 'delivered';
create index delivery_orders_is_oc_idx on public.delivery_orders (delivery_date) where is_oc;
create index delivery_orders_trip_idx on public.delivery_orders (driver_id, delivery_date, trip_no, trip_seq);

-- One SO can be split over many DOs (trips); one DO can combine many SOs
-- of the same debtor. Linked by SO number, so a DO can be imported before
-- its SO; so_id is filled in when the SO arrives.
create table public.do_sales_orders (
  do_id uuid not null references public.delivery_orders on delete cascade,
  so_no text not null,
  so_id uuid references public.sales_orders on delete set null,
  primary key (do_id, so_no)
);
create index on public.do_sales_orders (so_no);
create index on public.do_sales_orders (so_id);

create table public.do_items (
  id          uuid primary key default gen_random_uuid(),
  do_id       uuid not null references public.delivery_orders on delete cascade,
  so_item_id  uuid references public.so_items on delete set null,
  item_code   text not null,
  description text,
  uom         text,
  qty         numeric(12, 2) not null check (qty > 0)
);
create index on public.do_items (do_id);
create index on public.do_items (so_item_id);

-- ---------- Audit trail / timeline -----------------------------------
create table public.status_events (
  id         bigint generated always as identity primary key,
  so_id      uuid references public.sales_orders on delete cascade,
  do_id      uuid references public.delivery_orders on delete cascade,
  status     text not null,
  note       text,
  actor_id   uuid default auth.uid() references public.profiles on delete set null,
  created_at timestamptz not null default now()
);
create index on public.status_events (so_id);
create index on public.status_events (do_id);

-- ---------- Outstanding DO work (CN / edit DO / DR …) ----------------
-- Office notes for a DO that still needs fixing in AutoCount; cleared once done.
create table public.do_outstanding (
  id          uuid primary key default gen_random_uuid(),
  do_id       uuid not null references public.delivery_orders on delete cascade,
  reason      text not null,
  todo        text not null check (todo in ('cn', 'edit_do', 'dr', 'other')),
  todo_other  text,                          -- what "Others" means
  description text,
  created_by  uuid default auth.uid() references public.profiles on delete set null,
  created_at  timestamptz not null default now(),
  cleared_at  timestamptz,                   -- null = still outstanding
  cleared_by  uuid references public.profiles on delete set null
);
create index do_outstanding_do_id_idx on public.do_outstanding (do_id);
create index do_outstanding_open_idx on public.do_outstanding (created_at) where cleared_at is null;

-- ---------- Failed delivery attempts ---------------------------------
-- Every time a DO turns Failed, the attempt is kept here (driver, lorry, day, trip,
-- when they set off, why it failed). Commission and the trip form count these like
-- delivered DOs (the DO's own points), so a DO that fails and is redelivered earns twice.
create table public.delivery_attempts (
  id            uuid primary key default gen_random_uuid(),
  do_id         uuid not null references public.delivery_orders on delete cascade,
  driver_id     uuid references public.profiles on delete set null,
  lorry_id      uuid references public.lorries on delete set null,
  delivery_date date not null,
  trip_no       int not null default 1,
  started_at    timestamptz,                   -- when the driver tapped Start for this attempt
  failed_at     timestamptz not null default now(),
  failed_reason text
);
create index delivery_attempts_driver_idx on public.delivery_attempts (driver_id, failed_at);
create index delivery_attempts_do_idx on public.delivery_attempts (do_id);

-- ---------- AutoCount sync: when it last ran ---------------------------
-- The office computer's sync writes here after each run, so the Deliveries page
-- can show "AutoCount synced 2 min ago".
create table public.sync_status (
  source     text primary key,                 -- 'autocount'
  synced_at  timestamptz not null              -- last run that worked finished at
);

-- ---------- How much of each SO line is already on a DO --------------
create view public.so_item_progress with (security_invoker = true) as
select
  i.*,
  coalesce(sum(d.qty), 0)         as qty_on_do,
  i.qty - coalesce(sum(d.qty), 0) as qty_remaining
from public.so_items i
left join public.do_items d on d.so_item_id = i.id
group by i.id;

-- ---------- After an AutoCount import: tie SOs and DOs together --------
-- Fills do_sales_orders.so_id by SO number, copies the SOs' Remark 1 and
-- Delivery Phone onto their DOs (drivers can't read sales_orders), and
-- marks SOs that have a (non-cancelled) DO as fulfilled.
create or replace function public.sync_autocount_links() returns void
language sql security invoker set search_path = '' as $$
  update public.do_sales_orders l set so_id = s.id
  from public.sales_orders s
  where upper(s.so_no) = upper(l.so_no) and l.so_id is distinct from s.id;

  with agg as (
    select l.do_id,
      (array_agg(s.id order by s.so_no) filter (where s.id is not null))[1] as so_id,
      string_agg(distinct nullif(trim(s.remarks), ''), ' / ') as remarks,
      (array_agg(nullif(trim(s.phone), '') order by s.so_no) filter (where nullif(trim(s.phone), '') is not null))[1] as phone
    from public.do_sales_orders l
    left join public.sales_orders s on s.id = l.so_id
    group by l.do_id
  )
  update public.delivery_orders d set
    so_id = agg.so_id,
    remarks = agg.remarks,
    contact_phone = coalesce(agg.phone, d.contact_phone)
  from agg
  where d.id = agg.do_id
    and (d.so_id is distinct from agg.so_id
      or d.remarks is distinct from agg.remarks
      or d.contact_phone is distinct from coalesce(agg.phone, d.contact_phone));

  with st as (
    select s.id,
      case when exists (
        select 1 from public.do_sales_orders l
        join public.delivery_orders d on d.id = l.do_id
        where l.so_id = s.id and not d.cancelled
      ) then 'fulfilled'::public.so_status else 'open'::public.so_status end as status
    from public.sales_orders s
    where s.status <> 'cancelled'
  )
  update public.sales_orders s set status = st.status
  from st
  where s.id = st.id and s.status <> st.status;
$$;

-- ---------- Special DO → its AutoCount DO -----------------------------------
-- When AutoCount is down the office keys in a special DO (SDO-…). Once AutoCount is back
-- and has the real DO, the special DO takes the AutoCount number, so every sync from then
-- on updates it (driver, status, photos, points and history stay); special_no keeps the SDO-… it had.
-- If the sync already brought the AutoCount DO in as its own card, that card (not started yet)
-- is folded in: its items, SO links, history and notes move over, then it's removed.
-- All in one go: if anything fails nothing changes. Runs as the caller (staff only, by RLS).
create or replace function public.link_special_do(p_special uuid, p_do_no text) returns void
language plpgsql set search_path = '' as $$
declare
  sp  public.delivery_orders;
  dup public.delivery_orders;
begin
  select * into sp from public.delivery_orders where id = p_special for update;
  if sp.id is null or sp.source <> 'special' then raise exception 'Special DO not found.'; end if;

  select * into dup from public.delivery_orders where upper(do_no) = upper(p_do_no) and id <> p_special for update;
  if dup.id is not null then
    if dup.status not in ('pending', 'assigned') then
      raise exception '% is already out for delivery or delivered — it can''t be merged into %.', dup.do_no, sp.do_no;
    end if;
    -- AutoCount's items and SO links win; history, notes and any failed tries are kept from both.
    delete from public.do_items where do_id = sp.id;
    update public.do_items set do_id = sp.id where do_id = dup.id;
    delete from public.do_sales_orders where do_id = sp.id;
    update public.do_sales_orders set do_id = sp.id where do_id = dup.id;
    update public.status_events set do_id = sp.id where do_id = dup.id;
    update public.do_outstanding set do_id = sp.id where do_id = dup.id;
    update public.delivery_attempts set do_id = sp.id where do_id = dup.id;
    delete from public.delivery_orders where id = dup.id;
    update public.delivery_orders set
      so_id = dup.so_id, so_no = dup.so_no, customer_name = dup.customer_name, address = dup.address,
      contact_phone = coalesce(sp.contact_phone, dup.contact_phone), remarks = dup.remarks,
      branch = dup.branch, sales_branch = dup.sales_branch, ref = dup.ref, total = dup.total,
      invoice_no = dup.invoice_no, created_user = dup.created_user, cancelled = dup.cancelled
    where id = sp.id;
  end if;

  update public.delivery_orders
  set do_no = upper(trim(p_do_no)), special_no = sp.do_no, source = case when dup.id is null then source else 'autocount' end
  where id = sp.id;
end $$;
grant execute on function public.link_special_do(uuid, text) to authenticated;

-- ---------- Driver points & commission -------------------------------
-- Commission depends on points and delivery time, so drivers can't edit those (or anything
-- else the driver app doesn't change); for drivers delivered_at is always the server's clock.
create or replace function public.guard_delivery_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  kept public.delivery_orders;
begin
  if auth.uid() is not null and not public.is_staff() then  -- drivers (a server sync has no user)
    -- Drivers change only what the driver app changes: Start, Delivered (photo), Failed (reason),
    -- and the WhatsApp result. Everything else (date, address, points, cancelled, columns added
    -- later…) stays as it was. Once Delivered, only the WhatsApp result can change.
    kept := old;
    kept.wa_sent_at := new.wa_sent_at;
    kept.wa_error   := new.wa_error;
    if old.status <> 'delivered' then
      if new.status is distinct from old.status and new.status not in ('out_for_delivery', 'delivered', 'failed') then
        raise exception 'Drivers can only start, deliver or fail a delivery.';
      end if;
      kept.status         := new.status;
      kept.failed_reason  := new.failed_reason;
      kept.pod_photo_path := new.pod_photo_path;
    end if;
    new := kept;
  end if;
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    -- Staff recording a missed delivery (trip form) keep the time they typed.
    if not public.is_staff() or new.delivered_at is null or new.delivered_at is not distinct from old.delivered_at then
      new.delivered_at := now();
    end if;
    new.lorry_id := coalesce((select l.id from public.lorries l where l.driver_id = new.driver_id), new.lorry_id);
  end if;
  return new;
end $$;

create trigger guard_delivery_order
  before update on public.delivery_orders
  for each row execute function public.guard_delivery_order();

-- Keeps every failed attempt (see delivery_attempts).
create or replace function public.record_failed_attempt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'failed' and old.status is distinct from 'failed' then
    insert into public.delivery_attempts (do_id, driver_id, lorry_id, delivery_date, trip_no, started_at, failed_reason)
    values (
      new.id, new.driver_id,
      coalesce((select l.id from public.lorries l where l.driver_id = new.driver_id), new.lorry_id),
      new.delivery_date, new.trip_no,
      (select max(e.created_at) from public.status_events e where e.do_id = new.id and e.status = 'out_for_delivery'),
      new.failed_reason
    );
  end if;
  return null;
end $$;

create trigger record_failed_attempt
  after update of status on public.delivery_orders
  for each row execute function public.record_failed_attempt();


-- ---------- Row Level Security ---------------------------------------
alter table public.profiles        enable row level security;
alter table public.sales_orders    enable row level security;
alter table public.so_items        enable row level security;
alter table public.delivery_orders enable row level security;
alter table public.do_items        enable row level security;
alter table public.do_sales_orders enable row level security;
alter table public.status_events   enable row level security;
alter table public.do_outstanding  enable row level security;
alter table public.lorries         enable row level security;
alter table public.lorry_events    enable row level security;
alter table public.delivery_attempts enable row level security;
alter table public.sync_status     enable row level security;

-- Profiles: see yourself; staff see everyone; admins edit roles.
create policy "read own or staff"   on public.profiles for select using (id = (select auth.uid()) or (select public.is_staff()));
create policy "admin edits profiles" on public.profiles for update using ((select public.my_role()) = 'admin');

-- Staff (admin + dispatcher) can do everything on business tables.
-- (select …) makes Postgres check the role once per query, not once per row.
create policy "staff all" on public.sales_orders    for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff all" on public.so_items        for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff all" on public.delivery_orders for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff all" on public.do_items        for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff all" on public.do_sales_orders for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff all" on public.status_events   for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff all" on public.do_outstanding  for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff all" on public.lorries         for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff all" on public.lorry_events    for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff all" on public.delivery_attempts for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff all" on public.sync_status     for all using ((select public.is_staff())) with check ((select public.is_staff()));

-- Drivers: only their own delivery jobs.
create policy "driver reads own DOs" on public.delivery_orders
  for select using (driver_id = (select auth.uid()));
create policy "driver updates own DOs" on public.delivery_orders
  for update using (driver_id = (select auth.uid())) with check (driver_id = (select auth.uid()));
create policy "driver reads own DO items" on public.do_items
  for select using (exists (
    select 1 from public.delivery_orders d where d.id = do_id and d.driver_id = (select auth.uid())));
create policy "driver logs own events" on public.status_events
  for insert with check (actor_id = (select auth.uid()) and exists (
    select 1 from public.delivery_orders d where d.id = do_id and d.driver_id = (select auth.uid())));
create policy "driver reads own events" on public.status_events
  for select using (actor_id = (select auth.uid()));

create policy "driver reads own attempts" on public.delivery_attempts
  for select using (driver_id = (select auth.uid()));
-- A driver keeps seeing the points of a DO they failed, even after it's given to another driver.
create policy "driver reads attempted DOs" on public.delivery_orders
  for select using (exists (
    select 1 from public.delivery_attempts a where a.do_id = delivery_orders.id and a.driver_id = (select auth.uid())));

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.link_special_do(uuid, text) to authenticated;

-- ---------- Live updates for the dispatch board ----------------------
alter publication supabase_realtime add table public.delivery_orders;
alter publication supabase_realtime add table public.sync_status;  -- "synced 2 min ago"

-- ---------- Proof-of-delivery photo storage --------------------------
insert into storage.buckets (id, name, public) values ('pod', 'pod', false)
on conflict (id) do nothing;

create policy "pod upload" on storage.objects for insert to authenticated with check (bucket_id = 'pod');
create policy "pod read"   on storage.objects for select to authenticated using (bucket_id = 'pod');

-- ---------- After setup: users' branch and lorry number ---------------
-- update profiles set branch = 'GP', lorry_no = '93' where full_name = 'Azli';
