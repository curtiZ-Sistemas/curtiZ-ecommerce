create function private.representative_catalog_kit_groups(
  p_offset integer,
  p_query text,
  p_color text,
  p_size text,
  p_available boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with eligible as (
    select
      p.id as product_id,
      p.name,
      v.id as variant_id,
      v.sku,
      v.color_name as color,
      v.size,
      round(coalesce(v.price_override, p.base_price) * 100)::bigint as price_cents,
      m.pairs_per_sku,
      i.available_quantity as available,
      image.storage_path as image_path,
      image.alt_text as image_alt
    from public.products p
    join public.product_variants v on v.product_id = p.id
    join private.bling_catalog_metadata m on m.product_id = p.id and m.pairs_per_sku > 1
    left join public.inventory i on i.variant_id = v.id
    left join lateral (
      select pi.storage_path, pi.alt_text
      from public.product_images pi
      where pi.product_id = p.id and (pi.variant_id = v.id or pi.variant_id is null)
      order by (pi.variant_id = v.id) desc, pi.is_primary desc, pi.sort_order, pi.id
      limit 1
    ) image on true
    where p.status = 'active' and v.active
  ),
  matches as (
    select e.*
    from eligible e
    where (coalesce(p_query, '') = '' or
      e.name ilike '%' || coalesce(p_query, '') || '%' or e.color ilike '%' || coalesce(p_query, '') || '%'
      or e.size ilike '%' || coalesce(p_query, '') || '%')
      and (coalesce(p_color, '') = '' or lower(e.color) = lower(p_color))
      and (coalesce(p_size, '') = '' or lower(e.size) = lower(p_size))
      and (not coalesce(p_available, false) or coalesce(e.available, 0) > 0)
  ),
  product_page as (
    select m.product_id, m.name
    from matches m
    group by m.product_id, m.name
    order by lower(m.name), m.product_id
    limit 24 offset greatest(p_offset, 0)
  ),
  grouped as (
    select
      e.product_id,
      e.name,
      jsonb_agg(jsonb_build_object(
        'variantId', e.variant_id,
        'sku', e.sku,
        'color', e.color,
        'size', e.size,
        'unitPriceInCents', e.price_cents,
        'pairsPerSku', e.pairs_per_sku,
        'available', e.available,
        'imagePath', e.image_path,
        'imageAlt', e.image_alt
      ) order by e.color, e.size, e.variant_id) as variants
    from eligible e
    join product_page pp on pp.product_id = e.product_id
    group by e.product_id, e.name
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('productId', g.product_id, 'name', g.name, 'variants', g.variants)
        order by lower(g.name), g.product_id)
      from grouped g
    ), '[]'::jsonb),
    'total', (select count(distinct m.product_id) from matches m),
    'nextOffset', case when (select count(distinct m.product_id) from matches m) > greatest(p_offset, 0) + 24
      then greatest(p_offset, 0) + 24 else null end,
    'colors', coalesce((select jsonb_agg(options.color order by options.color)
      from (select distinct e.color from eligible e where nullif(btrim(e.color), '') is not null) options), '[]'::jsonb),
    'sizes', coalesce((select jsonb_agg(options.size order by options.size)
      from (select distinct e.size from eligible e where nullif(btrim(e.size), '') is not null) options), '[]'::jsonb)
  )
  where p_offset between 0 and 10000
    and coalesce(length(p_query), 0) <= 80
    and coalesce(length(p_color), 0) <= 80
    and coalesce(length(p_size), 0) <= 40;
$$;
revoke all on function private.representative_catalog_kit_groups(integer, text, text, text, boolean)
  from public, anon, authenticated, service_role;

create function public.list_representative_catalog_kit_groups(
  p_offset integer default 0,
  p_query text default '',
  p_color text default '',
  p_size text default '',
  p_available boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.representative_catalog_kit_groups(p_offset, p_query, p_color, p_size, p_available)
  where private.representative_catalog_access();
$$;
revoke all on function public.list_representative_catalog_kit_groups(integer, text, text, text, boolean)
  from public, anon, service_role;
grant execute on function public.list_representative_catalog_kit_groups(integer, text, text, text, boolean)
  to authenticated;

create function public.list_admin_representative_catalog_kit_groups(
  p_offset integer default 0,
  p_query text default '',
  p_color text default '',
  p_size text default '',
  p_available boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission('representatives.read_all') then
    raise exception 'kit_catalog_read_forbidden' using errcode = '42501';
  end if;

  return private.representative_catalog_kit_groups(p_offset, p_query, p_color, p_size, p_available);
end;
$$;
revoke all on function public.list_admin_representative_catalog_kit_groups(integer, text, text, text, boolean)
  from public, anon, service_role;
grant execute on function public.list_admin_representative_catalog_kit_groups(integer, text, text, text, boolean)
  to authenticated;
