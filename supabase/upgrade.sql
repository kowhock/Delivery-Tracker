-- =====================================================================
-- KH Delivery — database changes not yet applied
--
-- schema.sql is the database as it is now. To change it:
--   1. write the change below (use "if not exists" etc. so it is safe to run twice)
--   2. run this file in Supabase → SQL Editor
--   3. make the same change in schema.sql, then empty this file again
--
-- Changes before 2026-11-03 are in git history (git log -p supabase/upgrade.sql).
-- =====================================================================

-- 2026-11-03: trip form boxes the office types are saved (monthly Remarks; daily Lorry checking and
-- Trip boxes), one per driver per day per box (lib/trip-form.ts). The app saves to trip_form_notes.
-- New table only. If the older trip_form_remarks table was made, its remarks are copied over
-- (trip_form_remarks itself is left alone).
create table if not exists public.trip_form_notes (
  driver_id  uuid not null references public.profiles on delete cascade,
  date       date not null,
  field      text not null check (length(field) between 1 and 40),
  value      text not null check (length(value) between 1 and 60),
  updated_by uuid default auth.uid() references public.profiles on delete set null,
  updated_at timestamptz not null default now(),
  primary key (driver_id, date, field)
);
do $$
begin
  if to_regclass('public.trip_form_remarks') is not null then
    insert into public.trip_form_notes (driver_id, date, field, value, updated_by, updated_at)
    select driver_id, date, 'remark', remark, updated_by, updated_at from public.trip_form_remarks
    on conflict do nothing;
  end if;
end $$;
alter table public.trip_form_notes enable row level security;
drop policy if exists "staff all" on public.trip_form_notes;
create policy "staff all" on public.trip_form_notes for all using ((select public.is_staff())) with check ((select public.is_staff()));
grant select, insert, update, delete on public.trip_form_notes to authenticated;

-- 2026-11-04: Kurang Hantar special orders get a Refer DO box (the DO it makes up for), printed
-- below the Reason. New empty column: no existing rows change. Once printed, only admins and
-- allowed dispatchers can change it (same as the other fields).
alter table public.delivery_orders add column if not exists refer_do text check (length(refer_do) <= 40);

create or replace function public.guard_special_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.source = 'special' then
      raise exception '% can''t be deleted — an admin can void it instead.', old.do_no;
    end if;
    return old;
  end if;
  if old.voided_at is not null then
    raise exception '% is void and can''t be changed.', old.do_no;
  end if;
  if new.voided_at is not null and coalesce(public.my_role()::text, '') <> 'admin' then
    raise exception 'Only an admin can void a special order.';
  end if;
  if new.print_count < old.print_count then
    raise exception 'The print count of % can''t go down.', old.do_no;
  end if;
  if old.print_count > 0 and not public.can_handle_goods() and (
       new.customer_name, new.address, new.contact_phone, new.remarks, new.instructions,
       new.points, new.special_reason, new.branch, new.do_no, new.refer_do
     ) is distinct from (
       old.customer_name, old.address, old.contact_phone, old.remarks, old.instructions,
       old.points, old.special_reason, old.branch, old.do_no, old.refer_do
     ) then
    raise exception '% has been printed — only admins and dispatchers an admin has allowed can edit it.', old.do_no;
  end if;
  return new;
end $$;

-- 2026-11-05: M- DOs (inter-company invoices) get typed items: AutoCount sends no item lines for
-- invoices, so the office types them, one per line ("Cement x 1 bag"). lib/item-note.ts.
-- New empty column: no existing rows change. The AutoCount sync never writes it; drivers can't
-- change it (guard_delivery_order keeps every column the driver app doesn't set).
alter table public.delivery_orders add column if not exists item_note text check (length(item_note) <= 1000);

-- 2026-11-13: Trailers. A lorry can be ticked "Trailer": shared by every branch, so it has no branch
-- and never a driver. A DO's own branch can hand the DO to a trailer (DO popup → Assign other branch
-- → Trailer): it is delivered right away with no driver (so no points or commission), and
-- delivery_orders.trailer_id (and lorry_id) record the trailer. Taking it back puts the DO back in
-- Unassigned. New columns only: existing lorries stay normal lorries, existing DOs have no trailer.
alter table public.lorries add column if not exists is_trailer boolean not null default false;
alter table public.lorries drop constraint if exists lorries_trailer_check;
alter table public.lorries add constraint lorries_trailer_check
  check (not is_trailer or (branch is null and driver_id is null and borrow_branch is null));
alter table public.delivery_orders add column if not exists trailer_id uuid references public.lorries on delete set null;
-- Outsource trailer: an outside company's trailer delivered it (no lorry in the app). Same as a trailer otherwise.
alter table public.delivery_orders add column if not exists outsource_trailer boolean not null default false;

-- 2026-11-13: "Mark cancelled" for AutoCount DOs the sync missed (cancelled or deleted in AutoCount, but
-- the 5-minute sync only fetches documents whose Last Modified changed). The DO's own branch or an
-- admin marks it in the DO popup with a reason; it then counts as cancelled everywhere (cancelled = true).
-- The office_cancel_* columns are the app's own: the AutoCount sync never writes them, and the trigger
-- keeps cancelled = true while they're set, so a later sync can't bring the DO back. Undo clears them.
-- New empty columns + trigger: no existing rows change.
alter table public.delivery_orders add column if not exists office_cancelled_at timestamptz;
alter table public.delivery_orders add column if not exists office_cancelled_by uuid references public.profiles on delete set null;
alter table public.delivery_orders add column if not exists office_cancel_reason text check (length(office_cancel_reason) <= 200);

create or replace function public.keep_office_cancel() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.office_cancelled_at is not null then
    new.cancelled := true;
  end if;
  return new;
end $$;

drop trigger if exists keep_office_cancel on public.delivery_orders;
create trigger keep_office_cancel
  before insert or update on public.delivery_orders
  for each row execute function public.keep_office_cancel();
