begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into public.categories(id, name, slug) values
  ('c1000000-0000-4000-8000-000000000001', 'Teste cores visuais', 'teste-cores-visuais');
insert into public.products(id, name, slug, short_description, description, category_id,
  status, base_price, weight_grams, height_cm, width_cm, length_cm)
values ('c2000000-0000-4000-8000-000000000001', 'Sandália Visual', 'sandalia-visual-test',
  'Teste', 'Teste de cores e tamanhos', 'c1000000-0000-4000-8000-000000000001',
  'active', 50, 100, 5, 10, 20);
insert into public.product_categories(product_id, category_id, is_primary)
values ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', true);

with colors as (
  select * from (values (1, 'Lilás', '#AA88CC', 'lilas.webp'),
    (2, 'Bege', '#C7A77B', 'bege.webp'),
    (3, 'Preto', '#171717', 'preto.webp'),
    (4, 'Azul', '#123ABC', 'azul.webp')) as color(number, name, hex, image)
)
insert into public.product_variants(id, product_id, sku, color_name, color_hex, size, active)
select ('c3000000-0000-4000-8000-' || lpad((color.number * 100 + size.number)::text, 12, '0'))::uuid,
  'c2000000-0000-4000-8000-000000000001',
  'VISUAL-' || color.number || '-' || size.number, color.name, color.hex, size.number::text, true
from colors color cross join generate_series(34, 39) size(number);

insert into public.inventory(variant_id, available_quantity, reserved_quantity)
select id, case when size = '34' then 0 else 3 end, 0
from public.product_variants where product_id = 'c2000000-0000-4000-8000-000000000001';

insert into public.product_images(product_id, variant_id, storage_path, alt_text, width, height)
select 'c2000000-0000-4000-8000-000000000001', variant.id,
  'test/visual/' || case variant.color_name
    when 'Lilás' then 'lilas.webp' when 'Bege' then 'bege.webp'
    when 'Preto' then 'preto.webp' else 'azul.webp' end,
  variant.color_name, 720, 720
from public.product_variants variant
where variant.product_id = 'c2000000-0000-4000-8000-000000000001' and variant.size = '34';

select is((select count(*)::integer from private.storefront_catalog_items()
  where product_id = 'c2000000-0000-4000-8000-000000000001'), 4,
  'uma apresentação por imagem/cor, apesar dos seis tamanhos');
select ok((select variant_id is not null from private.storefront_catalog_items()
  where product_id = 'c2000000-0000-4000-8000-000000000001' and variant_color = 'Lilás'),
  'card Lilás conserva uma variante representativa');
select is((select image_path from private.storefront_catalog_items()
  where product_id = 'c2000000-0000-4000-8000-000000000001' and variant_color = 'Lilás'),
  'test/visual/lilas.webp', 'card Lilás mantém sua imagem');
select is((select variant_color from private.storefront_catalog_items()
  where product_id = 'c2000000-0000-4000-8000-000000000001' and image_path = 'test/visual/lilas.webp'),
  'Lilás', 'cor do card corresponde à fotografia');
select is((select variant_size from private.storefront_catalog_items()
  where product_id = 'c2000000-0000-4000-8000-000000000001' and variant_color = 'Lilás'),
  null::text, 'card de seis tamanhos não pré-seleciona tamanho');
select is((select sku from private.storefront_catalog_items()
  where product_id = 'c2000000-0000-4000-8000-000000000001' and variant_color = 'Lilás'),
  null::text, 'card de seis tamanhos não anuncia SKU arbitrário');
select is((select variant.color_name from private.storefront_catalog_items() card
  join public.product_variants variant on variant.id = card.variant_id
  where card.product_id = 'c2000000-0000-4000-8000-000000000001' and card.variant_color = 'Lilás'),
  'Lilás', 'variante representativa pertence à mesma cor');
select ok((select variant.active and variant.product_id = card.product_id
  from private.storefront_catalog_items() card
  join public.product_variants variant on variant.id = card.variant_id
  where card.product_id = 'c2000000-0000-4000-8000-000000000001' and card.variant_color = 'Lilás'),
  'variante representativa é ativa e pertence ao produto');
select ok((select inventory.available_quantity - inventory.reserved_quantity > 0
  from private.storefront_catalog_items() card
  join public.inventory inventory on inventory.variant_id = card.variant_id
  where card.product_id = 'c2000000-0000-4000-8000-000000000001' and card.variant_color = 'Lilás'),
  'variante com estoque tem prioridade sobre a variante da foto sem estoque');
update public.inventory set available_quantity = 3
where variant_id = 'c3000000-0000-4000-8000-000000000134';
select is((select variant_id from private.storefront_catalog_items()
  where product_id = 'c2000000-0000-4000-8000-000000000001' and variant_color = 'Lilás'),
  'c3000000-0000-4000-8000-000000000134'::uuid,
  'com estoque equivalente, a variante ligada à imagem tem prioridade');

select * from finish();
rollback;
