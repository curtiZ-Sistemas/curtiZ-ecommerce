-- O storefront usa search_catalog; visitantes não precisam consultar as tabelas internas.
-- Impede que o SELECT público exponha custos e outros campos operacionais.

revoke select on table public.products from anon;
revoke select on table public.product_variants from anon;
