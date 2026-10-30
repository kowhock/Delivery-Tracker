-- =====================================================================
-- KH Delivery — database changes not yet applied
--
-- schema.sql is the database as it is now. To change it:
--   1. write the change below (use "if not exists" etc. so it is safe to run twice)
--   2. run this file in Supabase → SQL Editor
--   3. make the same change in schema.sql, then empty this file again
--
-- Changes before 2026-10-16 are in git history (git log -p supabase/upgrade.sql).
-- =====================================================================

-- ---------- Delivery orders: address typed in by the office ---------------
-- When Google can't find the AutoCount delivery address, the office types one it
-- can find. Distance, points, best route and the driver's Waze/Maps then use it.
-- null = use the delivery address. Imports never touch it.
alter table public.delivery_orders add column if not exists map_address text;

-- ---------- Lorries ----------------------------------------------------
-- Each lorry has at most one driver, and each driver at most one lorry.
-- profiles.lorry_no is kept in step by a trigger (it's shown next to drivers' names).
create table if not exists public.lorries (
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
create table if not exists public.lorry_events (
  id         bigint generated always as identity primary key,
  lorry_id   uuid not null references public.lorries on delete cascade,
  note       text not null,
  actor_id   uuid default auth.uid() references public.profiles on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists lorry_events_lorry_idx on public.lorry_events (lorry_id, created_at);

-- The lorry a DO was delivered with (filled in when it's marked delivered), for the trip form.
alter table public.delivery_orders
  add column if not exists lorry_id uuid references public.lorries on delete set null;

create or replace function public.sync_lorry_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles p set lorry_no = (select l.lorry_no from public.lorries l where l.driver_id = p.id)
  where p.id in (old.driver_id, new.driver_id);
  return null;
end $$;

drop trigger if exists sync_lorry_no on public.lorries;
create trigger sync_lorry_no
  after insert or update or delete on public.lorries
  for each row execute function public.sync_lorry_no();

create or replace function public.guard_delivery_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_staff() then  -- drivers (a server sync has no user)
    new.points        := old.points;
    new.points_manual := old.points_manual;
    new.distance_km   := old.distance_km;
    new.instructions  := old.instructions;
    new.own_collection := old.own_collection;
    new.lorry_id      := old.lorry_id;
    new.map_address   := old.map_address;
  end if;
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    new.delivered_at := now();
    new.lorry_id := coalesce((select l.id from public.lorries l where l.driver_id = new.driver_id), new.lorry_id);
  end if;
  return new;
end $$;

alter table public.lorries      enable row level security;
alter table public.lorry_events enable row level security;
drop policy if exists "staff all" on public.lorries;
drop policy if exists "staff all" on public.lorry_events;
create policy "staff all" on public.lorries      for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff all" on public.lorry_events for all using ((select public.is_staff())) with check ((select public.is_staff()));
grant select, insert, update, delete on public.lorries, public.lorry_events to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Drivers who already have a lorry number get a lorry for it.
insert into public.lorries (lorry_no, branch, driver_id)
select distinct on (p.lorry_no) p.lorry_no, p.branch, p.id
from public.profiles p
where p.role = 'driver' and nullif(trim(p.lorry_no), '') is not null
order by p.lorry_no, p.full_name
on conflict (lorry_no) do nothing;

-- ---------- AutoCount sync: when it last ran ---------------------------
-- The office computer's sync writes here after each run, so the Deliveries page
-- can show "AutoCount synced 2 min ago".
create table if not exists public.sync_status (
  source     text primary key,                 -- 'autocount'
  synced_at  timestamptz not null              -- last run that worked finished at
);
alter table public.sync_status enable row level security;
drop policy if exists "staff all" on public.sync_status;
create policy "staff all" on public.sync_status for all using ((select public.is_staff())) with check ((select public.is_staff()));
grant select, insert, update, delete on public.sync_status to authenticated;
do $$ begin
  alter publication supabase_realtime add table public.sync_status;
exception when duplicate_object then null;
end $$;

-- ---------- Delivery orders: WhatsApp sent from the company number ------
-- Set when the server sends the "delivered" WhatsApp (with POD photo) through the
-- WhatsApp Cloud API. wa_error = why the last try failed (shown to the office).
alter table public.delivery_orders add column if not exists wa_sent_at timestamptz;
alter table public.delivery_orders add column if not exists wa_error   text;

-- ---------- Failed deliveries still earn points -------------------------
-- Every time a DO turns Failed, the attempt is kept here (driver, lorry, day, trip,
-- when they set off, why it failed). Commission and the trip form count these like
-- delivered DOs (the DO's own points), so a DO that fails and is redelivered earns twice.
create table if not exists public.delivery_attempts (
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
create index if not exists delivery_attempts_driver_idx on public.delivery_attempts (driver_id, failed_at);
create index if not exists delivery_attempts_do_idx on public.delivery_attempts (do_id);

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

drop trigger if exists record_failed_attempt on public.delivery_orders;
create trigger record_failed_attempt
  after update of status on public.delivery_orders
  for each row execute function public.record_failed_attempt();

alter table public.delivery_attempts enable row level security;
drop policy if exists "staff all" on public.delivery_attempts;
drop policy if exists "driver reads own attempts" on public.delivery_attempts;
create policy "staff all" on public.delivery_attempts for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "driver reads own attempts" on public.delivery_attempts for select using (driver_id = (select auth.uid()));
grant select, insert, update, delete on public.delivery_attempts to authenticated;

-- A driver keeps seeing the points of a DO they failed, even after it's given to another driver.
drop policy if exists "driver reads attempted DOs" on public.delivery_orders;
create policy "driver reads attempted DOs" on public.delivery_orders
  for select using (exists (
    select 1 from public.delivery_attempts a where a.do_id = delivery_orders.id and a.driver_id = (select auth.uid())));

-- DOs that are Failed right now get their attempt (failed at = when it was marked failed).
insert into public.delivery_attempts (do_id, driver_id, lorry_id, delivery_date, trip_no, started_at, failed_at, failed_reason)
select d.id, d.driver_id, coalesce((select l.id from public.lorries l where l.driver_id = d.driver_id), d.lorry_id),
       d.delivery_date, d.trip_no,
       (select max(e.created_at) from public.status_events e where e.do_id = d.id and e.status = 'out_for_delivery'),
       coalesce((select max(e.created_at) from public.status_events e where e.do_id = d.id and e.status = 'failed'), now()),
       d.failed_reason
from public.delivery_orders d
where d.status = 'failed' and not d.cancelled
  and not exists (select 1 from public.delivery_attempts a where a.do_id = d.id);

-- Every earlier failure from the DO history (status_events), including DOs that were failed
-- and then redelivered or unassigned before delivery_attempts existed. The driver is whoever
-- marked it failed (else the DO's driver); the day is the day it failed. Safe to run twice.
insert into public.delivery_attempts (do_id, driver_id, lorry_id, delivery_date, trip_no, started_at, failed_at, failed_reason)
select e.do_id, drv.id,
       (select l.id from public.lorries l where l.driver_id = drv.id),
       (e.created_at at time zone 'Asia/Kuala_Lumpur')::date,
       d.trip_no,
       (select max(s.created_at) from public.status_events s
         where s.do_id = e.do_id and s.status = 'out_for_delivery' and s.created_at <= e.created_at),
       e.created_at,
       e.note
from public.status_events e
join public.delivery_orders d on d.id = e.do_id and not d.cancelled
cross join lateral (
  select coalesce((select p.id from public.profiles p where p.id = e.actor_id and p.role = 'driver'), d.driver_id) as id
) drv
where e.status = 'failed'
  and not exists (
    select 1 from public.delivery_attempts a
    where a.do_id = e.do_id and a.failed_at between e.created_at - interval '1 minute' and e.created_at + interval '1 minute');

-- ---------- Special DO → its AutoCount DO -----------------------------------
-- When AutoCount is down the office keys in a special DO (SDO-…). Once AutoCount is back
-- and has the real DO, the special DO takes the AutoCount number, so every sync from then
-- on updates it (driver, status, photos, points and history stay). special_no = the SDO-… it had.
alter table public.delivery_orders add column if not exists special_no text;

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

-- ---------- Delivery orders: AutoCount Doc Date ---------------------------
-- The date on the DO (or M- invoice) in AutoCount, shown under the DO number.
-- delivery_date starts as this but the office can move it; this one only follows AutoCount.
-- Filled by the sync: run `npm run autocount:sync -- --days N` to fill older DOs.
alter table public.delivery_orders add column if not exists doc_date date;

-- ---------- Trip form: staff record a delivery at the time it happened -----
-- A DO the driver didn't mark in the app is recorded from the trip form with its real
-- "time back", so it counts on the right day. Drivers still always get the server's clock.
create or replace function public.guard_delivery_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_staff() then  -- drivers (a server sync has no user)
    new.points        := old.points;
    new.points_manual := old.points_manual;
    new.distance_km   := old.distance_km;
    new.instructions  := old.instructions;
    new.own_collection := old.own_collection;
    new.lorry_id      := old.lorry_id;
    new.map_address   := old.map_address;
  end if;
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    if not public.is_staff() or new.delivered_at is null or new.delivered_at is not distinct from old.delivered_at then
      new.delivered_at := now();
    end if;
    new.lorry_id := coalesce((select l.id from public.lorries l where l.driver_id = new.driver_id), new.lorry_id);
  end if;
  return new;
end $$;
