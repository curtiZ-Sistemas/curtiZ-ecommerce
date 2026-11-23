-- Admin navigation writes failed with 42501: the table only granted SELECT to
-- authenticated. RLS policy "taxonomy managers maintain store navigation"
-- already restricts writes to catalog.taxonomy.manage.
grant insert, update, delete on table public.store_navigation_items to authenticated;

notify pgrst, 'reload schema';
