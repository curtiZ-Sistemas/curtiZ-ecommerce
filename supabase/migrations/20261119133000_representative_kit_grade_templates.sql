alter table public.kits
  add column grade_product_id uuid references public.products(id),
  add column grade_color text,
  add constraint kits_grade_source_complete
    check ((grade_product_id is null and grade_color is null)
      or (grade_product_id is not null and nullif(btrim(grade_color), '') is not null));

create index kits_grade_product on public.kits (grade_product_id) where grade_product_id is not null;

create function private.representative_kit_grade_templates()
returns table (code text, label text, sort_order integer, size text, pairs integer)
language sql immutable set search_path = ''
as $$
  values
    ('standard', 'Ficha padrão', 1, '34', 1),
    ('standard', 'Ficha padrão', 1, '35', 2),
    ('standard', 'Ficha padrão', 1, '36', 3),
    ('standard', 'Ficha padrão', 1, '37', 3),
    ('standard', 'Ficha padrão', 1, '38', 2),
    ('standard', 'Ficha padrão', 1, '39', 1),
    ('lower_restock', 'Ficha reposição baixa', 2, '34', 1),
    ('lower_restock', 'Ficha reposição baixa', 2, '35', 3),
    ('lower_restock', 'Ficha reposição baixa', 2, '36', 4),
    ('lower_restock', 'Ficha reposição baixa', 2, '37', 4),
    ('upper_restock', 'Ficha reposição alta', 3, '37', 4),
    ('upper_restock', 'Ficha reposição alta', 3, '38', 4),
    ('upper_restock', 'Ficha reposição alta', 3, '39', 4);
$$;
revoke all on function private.representative_kit_grade_templates() from public, anon, authenticated, service_role;

create function private.representative_kit_grade_sources()
returns table (product_id uuid, product_name text, color text)
language sql stable set search_path = ''
as $$
  select p.id, p.name, v.color_name
  from public.products p
  join private.bling_catalog_metadata m on m.product_id = p.id and m.pairs_per_sku = 1
  join public.product_variants v on v.product_id = p.id and v.active
  where p.status = 'active' and nullif(btrim(v.color_name), '') is not null
    and v.size in ('34', '35', '36', '37', '38', '39')
  group by p.id, p.name, v.color_name
  having count(*) = 6 and count(distinct v.size) = 6;
$$;
revoke all on function private.representative_kit_grade_sources() from public, anon, authenticated, service_role;

create function public.list_representative_kit_grade_sources()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission('representatives.rules.manage') then
    raise exception 'kit_management_forbidden' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('productId', s.product_id, 'name', s.product_name, 'color', s.color)
      order by s.product_name, s.color, s.product_id)
    from private.representative_kit_grade_sources() s
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_representative_kit_grade_sources() from public, anon;
grant execute on function public.list_representative_kit_grade_sources() to authenticated;

create function private.validate_representative_kit_grade_source()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (old.grade_product_id, old.grade_color)
    is not distinct from (new.grade_product_id, new.grade_color) then
    return new;
  end if;
  if new.grade_product_id is not null and not exists (
    select 1 from private.representative_kit_grade_sources() s
    where (s.product_id, s.color) = (new.grade_product_id, new.grade_color)
  ) then
    raise exception 'invalid_kit_grade_source' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_representative_kit_grade_source() from public, anon, authenticated, service_role;

create trigger validate_representative_kit_grade_source
before insert or update of grade_product_id, grade_color on public.kits
for each row execute function private.validate_representative_kit_grade_source();

create function private.representative_kit_grade_components(p_kit uuid, p_template text)
returns table (size text, pairs integer, variant_id uuid, available integer)
language sql stable set search_path = ''
as $$
  select t.size, t.pairs, v.id, coalesce(i.available_quantity, 0)
  from public.kits k
  cross join private.representative_kit_grade_templates() t
  join private.representative_kit_grade_sources() s
    on (s.product_id, s.color) = (k.grade_product_id, k.grade_color)
  join public.product_variants v on v.product_id = s.product_id
    and v.color_name = s.color and v.size = t.size and v.active
  left join public.inventory i on i.variant_id = v.id
  where k.id = p_kit and k.active and k.deleted_at is null and t.code = p_template
  order by t.size;
$$;
revoke all on function private.representative_kit_grade_components(uuid, text) from public, anon, authenticated, service_role;

create function public.list_representative_kit_grade_offers()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kitId', k.id, 'name', k.name, 'description', k.description, 'color', k.grade_color,
    'unitPriceInCents', k.price_in_cents, 'templates', offers.templates
  ) order by k.name, k.id), '[]'::jsonb)
  from public.kits k
  join private.representative_kit_grade_sources() s
    on (s.product_id, s.color) = (k.grade_product_id, k.grade_color)
  cross join lateral (
    select jsonb_agg(jsonb_build_object(
      'code', t.code, 'label', t.label, 'available', stock.available, 'sizes', stock.sizes
    ) order by t.sort_order) as templates
    from (select distinct code, label, sort_order from private.representative_kit_grade_templates()) t
    cross join lateral (
      select min(c.available / c.pairs) as available,
        jsonb_agg(jsonb_build_object('size', c.size, 'pairs', c.pairs) order by c.size) as sizes
      from private.representative_kit_grade_components(k.id, t.code) c
    ) stock
  ) offers
  where k.active and k.deleted_at is null and k.price_in_cents > 0
    and private.representative_catalog_access();
$$;
revoke all on function public.list_representative_kit_grade_offers() from public, anon, service_role;
grant execute on function public.list_representative_kit_grade_offers() to authenticated;
