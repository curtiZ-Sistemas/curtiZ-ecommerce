begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

-- A product without variant photography uses the aggregated fallback card.
insert into public.categories(id, name, slug) values
 ('f1000000-0000-0000-0000-000000000001', 'Teste vitrine', 'teste-vitrine-variantes');
insert into public.products(id, name, slug, short_description, description, category_id, status, base_price, weight_grams, height_cm, width_cm, length_cm)
values ('f2000000-0000-0000-0000-000000000001', 'Sandália Teste Combinação', 'teste-combinacao-vitrine', 'Teste', 'Teste de variantes', 'f1000000-0000-0000-0000-000000000001', 'active', 50, 100, 5, 10, 20);
insert into public.product_categories(product_id, category_id, is_primary) values
 ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', true);
insert into public.product_images(product_id, storage_path, alt_text, width, height, is_primary) values
 ('f2000000-0000-0000-0000-000000000001', 'test/variant-match.webp', 'Teste', 720, 720, true);
insert into public.product_variants(id, product_id, sku, color_name, size) values
 ('f3000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'TEST-MATCH-W37', 'Branco', '37'),
 ('f3000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000001', 'TEST-MATCH-B38', 'Preto', '38'),
 ('f3000000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-000000000001', 'TEST-MATCH-B37', 'Preto', '37');
insert into public.inventory(variant_id, available_quantity, reserved_quantity) values
 ('f3000000-0000-0000-0000-000000000001', 3, 0),
 ('f3000000-0000-0000-0000-000000000002', 2, 0),
 ('f3000000-0000-0000-0000-000000000003', 1, 1)
on conflict (variant_id) do update set available_quantity = excluded.available_quantity, reserved_quantity = excluded.reserved_quantity;

set local role anon;
select is((public.search_catalog(p_category => 'teste-vitrine-variantes', p_colors => array['Preto'], p_sizes => array['37'])->>'total')::integer, 0, 'Não cruza Branco 37 com Preto 38 nem usa estoque reservado');
select is((public.search_catalog(p_category => 'teste-vitrine-variantes', p_colors => array['Preto'], p_sizes => array['38'])->>'total')::integer, 1, 'Encontra combinação realmente disponível');
select is((public.search_catalog(p_category => 'teste-vitrine-variantes', p_query => 'SANDALIA')->>'total')::integer, 1, 'Busca ignora caixa e acento');
reset role;
update public.inventory set reserved_quantity = 0 where variant_id = 'f3000000-0000-0000-0000-000000000003';
set local role anon;
select is((public.search_catalog(p_category => 'teste-vitrine-variantes', p_colors => array['Preto'], p_sizes => array['37'])->>'total')::integer, 1, 'Combinação aparece quando estoque é liberado');
reset role;
update public.product_variants set active = false where id = 'f3000000-0000-0000-0000-000000000003';
set local role anon;
select is((public.search_catalog(p_category => 'teste-vitrine-variantes', p_colors => array['Preto'], p_sizes => array['37'])->>'total')::integer, 0, 'Variante inativa não satisfaz filtro');
reset role;
select * from finish();
rollback;
