-- As policies existentes continuam limitando as linhas acessíveis.
-- As tabelas de 202609070003/004 podem existir sem grants de SELECT.
grant select on table public.product_categories to authenticated;
grant select on table public.store_navigation_items to authenticated;

notify pgrst, 'reload schema';
