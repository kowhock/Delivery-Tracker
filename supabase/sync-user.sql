-- =====================================================================
-- KH Delivery — staff user for the AutoCount sync (npm run autocount:sync)
--
-- 1. Supabase → Authentication → Users → Add user → Create new user
--      email:    autocount-sync@khdelivery.my
--      password: a long password, tick "Auto Confirm User"
-- 2. Put the same email/password in .env.local (SUPABASE_SYNC_EMAIL / SUPABASE_SYNC_PASSWORD)
-- 3. Supabase → SQL Editor → paste this → Run (makes it office staff, so it may save SOs/DOs)
-- =====================================================================

update public.profiles
set role = 'dispatcher', full_name = 'AutoCount sync'
where id = (select id from auth.users where email = 'autocount-sync@khdelivery.my');
