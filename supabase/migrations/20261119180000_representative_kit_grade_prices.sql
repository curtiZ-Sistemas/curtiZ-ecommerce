alter table public.kits
  add column grade_standard_price_cents bigint check (grade_standard_price_cents between 12 and 9999999999),
  add column grade_lower_restock_price_cents bigint check (grade_lower_restock_price_cents between 12 and 9999999999),
  add column grade_upper_restock_price_cents bigint check (grade_upper_restock_price_cents between 12 and 9999999999),
  add constraint kit_grade_prices_complete check (
    num_nonnulls(grade_standard_price_cents, grade_lower_restock_price_cents, grade_upper_restock_price_cents) = 0
    or (grade_product_id is not null
      and num_nonnulls(grade_standard_price_cents, grade_lower_restock_price_cents, grade_upper_restock_price_cents) = 3)
  );

create function private.representative_kit_grade_price(p_kit public.kits, p_template text)
returns bigint language sql immutable set search_path = ''
as $$
  select case p_template
    when 'standard' then coalesce(p_kit.grade_standard_price_cents, p_kit.price_in_cents)
    when 'lower_restock' then coalesce(p_kit.grade_lower_restock_price_cents, p_kit.price_in_cents)
    when 'upper_restock' then coalesce(p_kit.grade_upper_restock_price_cents, p_kit.price_in_cents)
  end;
$$;
revoke all on function private.representative_kit_grade_price(public.kits, text) from public, anon, authenticated, service_role;

create or replace function public.list_representative_kit_grade_offers()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kitId', k.id, 'name', k.name, 'description', k.description, 'color', k.grade_color,
    'unitPriceInCents', private.representative_kit_grade_price(k, 'standard'), 'templates', offers.templates
  ) order by k.name, k.id), '[]'::jsonb)
  from public.kits k
  join private.representative_kit_grade_sources() s
    on (s.product_id, s.color) = (k.grade_product_id, k.grade_color)
  cross join lateral (
    select jsonb_agg(jsonb_build_object(
      'code', t.code, 'label', t.label, 'available', stock.available, 'sizes', stock.sizes,
      'unitPriceInCents', private.representative_kit_grade_price(k, t.code)
    ) order by t.sort_order) as templates
    from (select distinct code, label, sort_order from private.representative_kit_grade_templates()) t
    cross join lateral (
      select min(c.available / c.pairs) as available,
        jsonb_agg(jsonb_build_object('size', c.size, 'pairs', c.pairs) order by c.size) as sizes
      from private.representative_kit_grade_components(k.id, t.code) c
    ) stock
  ) offers
  where k.active and k.deleted_at is null and private.representative_kit_grade_price(k, 'standard') >= 12
    and private.representative_catalog_access();
$$;

create or replace function private.representative_kit_grade_snapshot(p_kit uuid, p_template text)
returns jsonb
language sql stable set search_path = ''
as $$
  with components as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'variantId', c.variant_id, 'productId', v.product_id, 'size', c.size, 'pairs', c.pairs,
      'sku', v.sku, 'name', p.name, 'priceCents', inputs.price_cents, 'dimensions', inputs.dimensions,
      'fiscalHash', private.bling_kit_source_hash(v.id)
    ) order by c.variant_id), '[]'::jsonb) as lines,
    coalesce(sum(c.pairs), 0) as pairs
    from private.representative_kit_grade_components(p_kit, p_template) c
    join public.product_variants v on v.id = c.variant_id
    join public.products p on p.id = v.product_id
    join lateral private.representative_kit_shipping_inputs(v.id) inputs on inputs.price_cents > 0
  )
  select jsonb_build_object(
    'kitName', k.name, 'priceCents', price.cents, 'lines', components.lines,
    'catalogHash', encode(sha256(convert_to(jsonb_build_array(k.id, k.name, p_template,
      price.cents, components.lines)::text, 'UTF8')), 'hex'),
    'fiscalFingerprint', encode(sha256(convert_to(jsonb_build_array(k.id, p_template, (
      select jsonb_agg(jsonb_build_array(line -> 'variantId', line -> 'pairs', line -> 'fiscalHash') order by line ->> 'variantId')
      from jsonb_array_elements(components.lines) line
    ))::text, 'UTF8')), 'hex')
  )
  from public.kits k cross join components
  cross join lateral (select private.representative_kit_grade_price(k, p_template) as cents) price
  where k.id = p_kit and price.cents >= 12 and components.pairs = 12;
$$;
