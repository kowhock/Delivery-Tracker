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
