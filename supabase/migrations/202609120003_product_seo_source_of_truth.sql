-- SEO e o preflight HTTP usam a mesma projeção comercial que catálogo,
-- categorias, homepage e recomendações. As funções são deliberadamente
-- pequenas: não expõem colunas internas de produtos aos papéis públicos.

create or replace function public.storefront_product_exists(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.storefront_catalog_items() item
    where item.slug = trim(p_slug)
  );
$$;

revoke all on function public.storefront_product_exists(text) from public;
grant execute on function public.storefront_product_exists(text) to anon, authenticated;

create or replace function public.get_storefront_product_seo_entries(
  p_limit integer default 50000
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', entry.slug,
    'updatedAt', entry.updated_at
  ) order by entry.slug), '[]'::jsonb)
  from (
    select item.slug, max(product.updated_at) as updated_at
    from private.storefront_catalog_items() item
    join public.products product on product.id = item.product_id
    group by item.slug
    order by item.slug
    limit greatest(1, least(coalesce(p_limit, 50000), 50000))
  ) entry;
$$;

revoke all on function public.get_storefront_product_seo_entries(integer) from public;
grant execute on function public.get_storefront_product_seo_entries(integer) to anon, authenticated;

-- Correção idempotente do item citado no incidente. Arquivar preserva chaves
-- estrangeiras e o histórico de pedidos; não há exclusão de registro comercial.
update public.products
set status = 'archived',
    status_reason = coalesce(nullif(status_reason, ''), 'Produto descontinuado e removido da vitrine'),
    updated_at = now()
where slug = 'slide-bold-marinho'
  and status = 'active';

notify pgrst, 'reload schema';
