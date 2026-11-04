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
