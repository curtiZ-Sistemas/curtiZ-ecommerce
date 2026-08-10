-- Materializa o catalogo inicial da curti Z como dados reais e editaveis.
-- O frontend deixa de depender dos oito produtos locais para apresentar a loja.

insert into public.categories(id, name, slug, description, active, sort_order)
values
  ('10000000-0000-0000-0000-000000000001', 'Masculino', 'masculino', 'Chinelos e slides masculinos', true, 1),
  ('10000000-0000-0000-0000-000000000002', 'Feminino', 'feminino', 'Chinelos e sandálias femininas', true, 2),
  ('10000000-0000-0000-0000-000000000003', 'Infantil', 'infantil', 'Conforto para crianças', true, 3),
  ('10000000-0000-0000-0000-000000000004', 'Slides', 'slides', 'Slides curti Z', true, 4),
  ('10000000-0000-0000-0000-000000000005', 'Sandálias', 'sandalias', 'Sandálias curti Z', true, 5)
on conflict (slug) do update
set active = true,
    updated_at = pg_catalog.now();

with catalog(
  product_id, name, slug, short_description, description, category_slug,
  featured, base_price, compare_at_price, cost_price, weight_grams,
  height_cm, width_cm, length_cm, seo_title, seo_description
) as (
  values
    ('20000000-0000-0000-0000-000000000001'::uuid, 'curti Z Flip-Flop Wave Preto', 'flip-flop-wave-preto', 'Leve, resistente e macio.', 'Leve, resistente e macio para acompanhar todos os momentos.', 'masculino', true, 59.90, 79.90, 22.00, 350, 8.00, 20.00, 30.00, 'Flip-Flop Wave Preto', 'Chinelo masculino leve, resistente e macio.'),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'curti Z Flip-Flop Slim Coral', 'flip-flop-slim-coral', 'Design minimalista em tom coral.', 'Design minimalista em tom coral vibrante e palmilha confortavel.', 'feminino', true, 54.90, 69.90, 20.00, 320, 8.00, 20.00, 30.00, 'Flip-Flop Slim Coral', 'Chinelo feminino coral com design minimalista.'),
    ('20000000-0000-0000-0000-000000000003'::uuid, 'curti Z Slide Bold Marinho', 'slide-bold-marinho', 'Slide marcante com base anatomica.', 'Slide marcante com tira acolchoada e base anatomica.', 'slides', true, 79.90, 99.90, 31.00, 430, 10.00, 22.00, 32.00, 'Slide Bold Marinho', 'Slide marinho com tira acolchoada e base anatomica.'),
    ('20000000-0000-0000-0000-000000000004'::uuid, 'curti Z Sandália Comfort Areia', 'sandalia-comfort-areia', 'Sandália versátil com ajuste seguro.', 'Sandália versátil com ajuste seguro e acabamento suave.', 'sandalias', true, 79.90, 109.90, 34.00, 390, 9.00, 21.00, 31.00, 'Sandália Comfort Areia', 'Sandália areia versátil, segura e confortável.'),
    ('20000000-0000-0000-0000-000000000005'::uuid, 'curti Z Infantil Joy Rosa', 'infantil-joy-rosa', 'Conforto e segurança para os pequenos.', 'Conforto, cores alegres e segurança para os pequenos.', 'infantil', true, 39.90, 49.90, 15.00, 240, 7.00, 17.00, 24.00, 'Infantil Joy Rosa', 'Chinelo infantil rosa confortável e seguro.'),
    ('20000000-0000-0000-0000-000000000006'::uuid, 'curti Z Slide Soft Preto', 'slide-soft-preto', 'Visual urbano e toque macio.', 'Visual urbano, construção monobloco e toque macio.', 'slides', false, 69.90, null, 27.00, 420, 10.00, 22.00, 32.00, 'Slide Soft Preto', 'Slide preto urbano com construção monobloco.'),
    ('20000000-0000-0000-0000-000000000007'::uuid, 'curti Z Flip-Flop Classic Preto', 'flip-flop-classic-preto', 'O essencial bem-feito.', 'O essencial bem-feito, com conforto e durabilidade.', 'masculino', false, 49.90, null, 18.00, 340, 8.00, 20.00, 30.00, 'Flip-Flop Classic Preto', 'Chinelo preto essencial, confortavel e duravel.'),
    ('20000000-0000-0000-0000-000000000008'::uuid, 'curti Z Slide Comfort Bege', 'slide-comfort-bege', 'Tons naturais e conforto.', 'Tons naturais e conforto para uma rotina leve.', 'feminino', false, 74.90, null, 29.00, 410, 10.00, 22.00, 32.00, 'Slide Comfort Bege', 'Slide bege em tons naturais para a rotina.')
)
insert into public.products(
  id, name, slug, short_description, description, category_id, status,
  featured, base_price, compare_at_price, cost_price, weight_grams,
  height_cm, width_cm, length_cm, seo_title, seo_description, published_at
)
select
  catalog.product_id, catalog.name, catalog.slug, catalog.short_description,
  catalog.description, category.id, 'active'::public.product_status,
  catalog.featured, catalog.base_price, catalog.compare_at_price,
  catalog.cost_price, catalog.weight_grams, catalog.height_cm,
  catalog.width_cm, catalog.length_cm, catalog.seo_title,
  catalog.seo_description, pg_catalog.now()
from catalog
join public.categories category on category.slug = catalog.category_slug
on conflict (slug) do update
set status = 'active'::public.product_status,
    featured = excluded.featured,
    updated_at = pg_catalog.now();

with variant_sets(product_slug, sku_prefix, colors, sizes, total_stock) as (
  values
    ('flip-flop-wave-preto', 'CZT-FW', array['Preto', 'Marinho']::text[], array['37/38', '39/40', '41/42', '43/44']::text[], 156),
    ('flip-flop-slim-coral', 'CZT-FS', array['Coral', 'Rosa']::text[], array['33/34', '35/36', '37/38', '39/40']::text[], 73),
    ('slide-bold-marinho', 'CZT-SB', array['Marinho', 'Branco']::text[], array['35/36', '37/38', '39/40', '41/42']::text[], 98),
    ('sandalia-comfort-areia', 'CZT-SC', array['Areia', 'Caramelo']::text[], array['34', '35', '36', '37', '38', '39']::text[], 64),
    ('infantil-joy-rosa', 'CZT-IJ', array['Rosa', 'Azul']::text[], array['25/26', '27/28', '29/30', '31/32']::text[], 112),
    ('slide-soft-preto', 'CZT-SS', array['Preto']::text[], array['35/36', '37/38', '39/40', '41/42']::text[], 81),
    ('flip-flop-classic-preto', 'CZT-FC', array['Preto']::text[], array['37/38', '39/40', '41/42', '43/44']::text[], 129),
    ('slide-comfort-bege', 'CZT-CB', array['Bege']::text[], array['33/34', '35/36', '37/38', '39/40']::text[], 55)
), expanded as (
  select
    product_slug,
    pg_catalog.format('%s-C%s-S%s', sku_prefix, color_position, size_position) as sku,
    color_name,
    size_name
  from variant_sets
  cross join lateral pg_catalog.unnest(colors) with ordinality as color_value(color_name, color_position)
  cross join lateral pg_catalog.unnest(sizes) with ordinality as size_value(size_name, size_position)
)
insert into public.product_variants(product_id, sku, color_name, color_hex, size, active)
select
  product.id,
  expanded.sku,
  expanded.color_name,
  case expanded.color_name
    when 'Preto' then '#171717'
    when 'Marinho' then '#172554'
    when 'Coral' then '#CF6853'
    when 'Rosa' then '#E879A9'
    when 'Branco' then '#F8FAFC'
    when 'Areia' then '#D6C2A3'
    when 'Caramelo' then '#A16207'
    when 'Azul' then '#2563EB'
    when 'Bege' then '#D4B896'
    else null
  end,
  expanded.size_name,
  true
from expanded
join public.products product on product.slug = expanded.product_slug
on conflict do nothing;

with variant_sets(product_slug, sku_prefix, colors, sizes, total_stock) as (
  values
    ('flip-flop-wave-preto', 'CZT-FW', array['Preto', 'Marinho']::text[], array['37/38', '39/40', '41/42', '43/44']::text[], 156),
    ('flip-flop-slim-coral', 'CZT-FS', array['Coral', 'Rosa']::text[], array['33/34', '35/36', '37/38', '39/40']::text[], 73),
    ('slide-bold-marinho', 'CZT-SB', array['Marinho', 'Branco']::text[], array['35/36', '37/38', '39/40', '41/42']::text[], 98),
    ('sandalia-comfort-areia', 'CZT-SC', array['Areia', 'Caramelo']::text[], array['34', '35', '36', '37', '38', '39']::text[], 64),
    ('infantil-joy-rosa', 'CZT-IJ', array['Rosa', 'Azul']::text[], array['25/26', '27/28', '29/30', '31/32']::text[], 112),
    ('slide-soft-preto', 'CZT-SS', array['Preto']::text[], array['35/36', '37/38', '39/40', '41/42']::text[], 81),
    ('flip-flop-classic-preto', 'CZT-FC', array['Preto']::text[], array['37/38', '39/40', '41/42', '43/44']::text[], 129),
    ('slide-comfort-bege', 'CZT-CB', array['Bege']::text[], array['33/34', '35/36', '37/38', '39/40']::text[], 55)
), expanded as (
  select
    variant_sets.*,
    color_name,
    size_name,
    color_position,
    size_position,
    pg_catalog.format('%s-C%s-S%s', sku_prefix, color_position, size_position) as sku,
    pg_catalog.cardinality(colors) * pg_catalog.cardinality(sizes) as combination_count,
    ((color_position - 1) * pg_catalog.cardinality(sizes) + size_position)::integer as sequence
  from variant_sets
  cross join lateral pg_catalog.unnest(colors) with ordinality as color_value(color_name, color_position)
  cross join lateral pg_catalog.unnest(sizes) with ordinality as size_value(size_name, size_position)
)
insert into public.inventory(
  variant_id, available_quantity, reserved_quantity, damaged_quantity,
  minimum_quantity, ideal_quantity
)
select
  variant.id,
  (expanded.total_stock / expanded.combination_count)
    + case when expanded.sequence <= expanded.total_stock % expanded.combination_count then 1 else 0 end,
  0,
  0,
  2,
  greatest(5, pg_catalog.ceil(expanded.total_stock::numeric / expanded.combination_count)::integer)
from expanded
join public.products product on product.slug = expanded.product_slug
join public.product_variants variant
  on variant.product_id = product.id
 and variant.color_name = expanded.color_name
 and variant.size = expanded.size_name
on conflict (variant_id) do update
set available_quantity = excluded.available_quantity,
    minimum_quantity = excluded.minimum_quantity,
    ideal_quantity = excluded.ideal_quantity,
    version = public.inventory.version + 1,
    updated_at = pg_catalog.now();

with images(product_slug, image_id, storage_path, alt_text) as (
  values
    ('flip-flop-wave-preto', '32000000-0000-0000-0000-000000000001'::uuid, '/images/products/wave-preto.png', 'curti Z Flip-Flop Wave Preto'),
    ('flip-flop-slim-coral', '32000000-0000-0000-0000-000000000002'::uuid, '/images/products/slim-coral.png', 'curti Z Flip-Flop Slim Coral'),
    ('slide-bold-marinho', '32000000-0000-0000-0000-000000000003'::uuid, '/images/products/bold-marinho.png', 'curti Z Slide Bold Marinho'),
    ('sandalia-comfort-areia', '32000000-0000-0000-0000-000000000004'::uuid, '/images/products/comfort-areia.png', 'curti Z Sandália Comfort Areia'),
    ('infantil-joy-rosa', '32000000-0000-0000-0000-000000000005'::uuid, '/images/products/joy-rosa.png', 'curti Z Infantil Joy Rosa'),
    ('slide-soft-preto', '32000000-0000-0000-0000-000000000006'::uuid, '/images/products/soft-preto.png', 'curti Z Slide Soft Preto'),
    ('flip-flop-classic-preto', '32000000-0000-0000-0000-000000000007'::uuid, '/images/products/classic-preto.png', 'curti Z Flip-Flop Classic Preto'),
    ('slide-comfort-bege', '32000000-0000-0000-0000-000000000008'::uuid, '/images/products/comfort-bege.png', 'curti Z Slide Comfort Bege')
)
insert into public.product_images(
  id, product_id, storage_path, alt_text, sort_order, is_primary, width, height
)
select
  images.image_id,
  product.id,
  images.storage_path,
  images.alt_text,
  0,
  true,
  1254,
  1254
from images
join public.products product on product.slug = images.product_slug
where not exists (
  select 1
  from public.product_images existing_image
  where existing_image.product_id = product.id
)
on conflict do nothing;

insert into public.banners(
  id, internal_title, title, subtitle, description,
  image_path_desktop, image_path_mobile, alt_text, button_text,
  destination_type, destination_url, open_new_tab, position, status,
  starts_at, sort_order, priority, content_alignment
)
select
  '60000000-0000-0000-0000-000000000001'::uuid,
  'Banner principal curti Z',
  'Conforto com estilo para todos os momentos',
  'Conheca a selecao curti Z',
  'Catalogo inicial da loja curti Z.',
  '/images/hero-curtiz-desktop.png',
  '/images/hero-curtiz-mobile.png',
  'Pessoas usando produtos curti Z',
  'Explorar colecao',
  'internal_page',
  '/produtos',
  false,
  'hero',
  'published',
  pg_catalog.now() - interval '1 minute',
  0,
  100,
  'left'
where not exists (
  select 1
  from public.banners banner
  where banner.position = 'hero'
    and banner.status in ('published', 'scheduled')
    and (banner.starts_at is null or banner.starts_at <= pg_catalog.now())
    and (banner.ends_at is null or banner.ends_at > pg_catalog.now())
)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
