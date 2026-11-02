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

-- 2026-10-30: hand a DO over to another branch, which then helps deliver it. That branch's
-- dispatchers see it and can pick its driver; the DO's own branch keeps seeing and planning it.
-- Points stay measured from the DO's own store. The AutoCount sync never touches this column.
alter table public.delivery_orders add column if not exists helper_branch text;

-- 2026-10-30: Supplier delivery — the supplier delivers the DO, so it has no driver (no points)
-- and is delivered as soon as staff pick it. It has its own column on Deliveries, not Unassigned.
alter table public.delivery_orders add column if not exists supplier_delivery boolean not null default false;

-- 2026-10-30: "Borrow to" — a lorry lent to another branch. That branch sees it on Lorries and can
-- put its own driver on it; the owning branch keeps it (maintenance, Take back). Nothing else changes.
alter table public.lorries add column if not exists borrow_branch text;

-- 2026-11-02: Special order (SDO) reason, items, print and void — GP branch first (lib/special.ts).
-- Reason is required on GP SDOs. Ambil Barang / Tumpang Barang SDOs carry their own items
-- (do_items) and remark (remarks), can be edited and printed only by admins and dispatchers that
-- an admin ticked (profiles.sdo_goods); once printed, only those people can edit them. Only admins can void; a void
-- keeps the row (cancelled = true, so it drops out of driver jobs and points) and shows as VOID.
alter table public.profiles add column if not exists sdo_goods boolean not null default false;
alter table public.delivery_orders add column if not exists special_reason text
  check (special_reason in ('ambil_barang', 'tumpang_barang', 'stock_transfer', 'ambil_give_do', 'other'));
alter table public.delivery_orders add column if not exists print_count int not null default 0;
alter table public.delivery_orders add column if not exists printed_at  timestamptz;
alter table public.delivery_orders add column if not exists printed_by  uuid references public.profiles on delete set null;
alter table public.delivery_orders add column if not exists voided_at   timestamptz;
alter table public.delivery_orders add column if not exists voided_by   uuid references public.profiles on delete set null;

-- Admins and dispatchers an admin ticked (profiles.sdo_goods). No logged-in user (service key /
-- SQL editor) also passes. Same rule as canHandleGoods in lib/special.ts.
create or replace function public.can_handle_goods() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is null or coalesce(
    (select p.role = 'admin' or p.sdo_goods from public.profiles p where p.id = auth.uid()), false)
$$;

-- Printed special orders: only admins / allowed dispatchers edit; void = admin only; never deleted.
-- Checked in the database so no screen or direct API call can get round it.
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
       new.points, new.special_reason, new.branch, new.do_no
     ) is distinct from (
       old.customer_name, old.address, old.contact_phone, old.remarks, old.instructions,
       old.points, old.special_reason, old.branch, old.do_no
     ) then
    raise exception '% has been printed — only admins and dispatchers an admin has allowed can edit it.', old.do_no;
  end if;
  return new;
end $$;

drop trigger if exists guard_special_order on public.delivery_orders;
create trigger guard_special_order
  before update or delete on public.delivery_orders
  for each row execute function public.guard_special_order();

-- A void special order's items can't change; a printed one's only by admins / allowed dispatchers.
create or replace function public.guard_special_items() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  d public.delivery_orders;
begin
  select * into d from public.delivery_orders where id = coalesce(new.do_id, old.do_id);
  if d.id is not null and d.voided_at is not null then
    raise exception '% is void — its items can''t change.', d.do_no;
  end if;
  if d.id is not null and d.print_count > 0 and not public.can_handle_goods() then
    raise exception '% has been printed — only admins and dispatchers an admin has allowed can change its items.', d.do_no;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists guard_special_items on public.do_items;
create trigger guard_special_items
  before insert or update or delete on public.do_items
  for each row execute function public.guard_special_items();
