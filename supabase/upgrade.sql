-- =====================================================================
-- KH Delivery — database changes not yet applied
--
-- schema.sql is the database as it is now. To change it:
--   1. write the change below (use "if not exists" etc. so it is safe to run twice)
--   2. run this file in Supabase → SQL Editor
--   3. make the same change in schema.sql, then empty this file again
--
-- Changes before 2026-11-24 are in git history (git log -p supabase/upgrade.sql).
-- =====================================================================

-- 2026-11-25: Drivers read branch_settings too, so a driver of a branch with points off sees no points in
-- the driver app (no commission bar, no ⭐ on DOs; lib/branches.ts driverSeesPoints). It only holds branch
-- codes and the on/off switch. Read only — changing it stays admin-only. No data changes.
drop policy if exists "drivers read" on public.branch_settings;
create policy "drivers read" on public.branch_settings for select to authenticated using (true);
