-- =====================================================================
-- Delivery Tracker — database schema
-- Run this whole file once in Supabase → SQL Editor → New query → Run.
-- =====================================================================

-- ---------- Enums ----------------------------------------------------
create type public.user_role as enum ('admin', 'dispatcher', 'driver');
create type public.so_status as enum ('open', 'partial', 'fulfilled', 'cancelled');
create type public.do_status as enum ('pending', 'assigned', 'out_for_delivery', 'delivered', 'failed');

-- ---------- Users / roles --------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  full_name  text not null default '',
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
  remarks        text,                         -- Remark 1 of the linked SO(s)
  delivery_date  date not null default current_date,
  branch         text,                         -- delivering branch, from the DO number prefix (GPD → GP)
  sales_branch   text,                         -- agent's branch, from Sales Location; follows the DO too
  ref            text,                         -- AutoCount Ref. (customer PO etc.)
  total          numeric(14, 2),
  invoice_no     text,                         -- AutoCount Transfer To (invoice)
  created_user   text,                         -- AutoCount Created User
  cancelled      boolean not null default false,
  source         text not null default 'manual', -- autocount | special
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
  driver_id      uuid references public.profiles on delete set null,
  trip_no        int not null default 1 check (trip_no > 0), -- which trip of the driver's day
  trip_seq       int not null default 0,                     -- stop order inside the trip
  status         public.do_status not null default 'pending',
  failed_reason  text,
  pod_photo_path text,                         -- proof-of-delivery photo in storage bucket "pod"
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
create table if not exists public.do_outstanding (
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
create index if not exists do_outstanding_do_id_idx on public.do_outstanding (do_id);
create index if not exists do_outstanding_open_idx on public.do_outstanding (created_at) where cleared_at is null;

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

-- ---------- Driver points & commission -------------------------------
-- Commission depends on points and delivery time, so drivers can't edit
-- those themselves; delivered_at is always the server's clock.
create or replace function public.guard_delivery_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_staff() then  -- drivers (a server sync has no user)
    new.points        := old.points;
    new.points_manual := old.points_manual;
    new.distance_km   := old.distance_km;
    new.instructions  := old.instructions;
    new.own_collection := old.own_collection;
  end if;
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    new.delivered_at := now();
  end if;
  return new;
end $$;

drop trigger if exists guard_delivery_order on public.delivery_orders;
create trigger guard_delivery_order
  before update on public.delivery_orders
  for each row execute function public.guard_delivery_order();


-- ---------- Row Level Security ---------------------------------------
alter table public.profiles        enable row level security;
alter table public.sales_orders    enable row level security;
alter table public.so_items        enable row level security;
alter table public.delivery_orders enable row level security;
alter table public.do_items        enable row level security;
alter table public.do_sales_orders enable row level security;
alter table public.status_events   enable row level security;
alter table public.do_outstanding  enable row level security;

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

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------- Live updates for the dispatch board ----------------------
alter publication supabase_realtime add table public.delivery_orders;

-- ---------- Proof-of-delivery photo storage --------------------------
insert into storage.buckets (id, name, public) values ('pod', 'pod', false)
on conflict (id) do nothing;

create policy "pod upload" on storage.objects for insert to authenticated with check (bucket_id = 'pod');
create policy "pod read"   on storage.objects for select to authenticated using (bucket_id = 'pod');
