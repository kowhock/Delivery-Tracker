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

-- 2026-11-03: monthly trip form Remarks (OFF, MC, …) are saved, one per driver per day, so the
-- office can type them day by day and still see them at month end (lib/trip-form.ts).
-- New table only: no existing rows change.
create table if not exists public.trip_form_remarks (
  driver_id  uuid not null references public.profiles on delete cascade,
  date       date not null,
  remark     text not null check (length(remark) between 1 and 60),
  updated_by uuid default auth.uid() references public.profiles on delete set null,
  updated_at timestamptz not null default now(),
  primary key (driver_id, date)
);
alter table public.trip_form_remarks enable row level security;
drop policy if exists "staff all" on public.trip_form_remarks;
create policy "staff all" on public.trip_form_remarks for all using ((select public.is_staff())) with check ((select public.is_staff()));
grant select, insert, update, delete on public.trip_form_remarks to authenticated;
