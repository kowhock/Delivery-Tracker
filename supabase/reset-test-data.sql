-- =====================================================================
-- KH Delivery — delete TEST data before going live
--
-- Supabase → SQL Editor → paste → Run. Cannot be undone.
-- Deletes: all SOs, DOs (AutoCount and special), their items, SO↔DO links,
--          timelines and outstanding records. Restarts SDO numbering at SDO-000001.
-- Keeps:   users/profiles (admin, staff, drivers) and lorries.
-- Proof-of-delivery photos: empty them in Supabase → Storage → pod.
-- =====================================================================

begin;

truncate table
  public.do_outstanding,
  public.status_events,
  public.do_items,
  public.do_sales_orders,
  public.delivery_orders,
  public.so_items,
  public.sales_orders;

alter sequence public.do_no_seq restart with 1;

-- Optional: also clear lorry history (driver changes, maintenance log). Remove the -- to run it.
-- truncate table public.lorry_events;

commit;
