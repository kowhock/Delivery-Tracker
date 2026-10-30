-- =====================================================================
-- KH Delivery — database changes not yet applied
--
-- schema.sql is the database as it is now. To change it:
--   1. write the change below (use "if not exists" etc. so it is safe to run twice)
--   2. run this file in Supabase → SQL Editor
--   3. make the same change in schema.sql, then empty this file again
--
-- Changes before 2026-10-30 are in git history (git log -p supabase/upgrade.sql).
-- =====================================================================

-- 2026-10-30: the person's real (legal) name, for admin reference only. full_name stays the
-- display name shown in the app; login (username) and every rule are unchanged.
alter table public.profiles add column if not exists real_name text;
