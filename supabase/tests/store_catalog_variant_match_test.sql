begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- A product without variant photography uses the aggregated fallback card.
insert into public.categories(id, name, slug) values
 ('f1000000-0000-0000-0000-000000000001', 'Teste vitrine', 'teste-vitrine-variantes');
insert into public.products(id, name, slug, short_description, description, category_id, status, base_price, weight_grams, height_cm, width_cm, length_cm)
values ('f2000000-0000-0000-0000-000000000001', 'Sandália Teste Combinação', 'teste-combinacao-vitrine', 'Teste', 'Teste de variantes', 'f1000000-0000-0000-0000-000000000001', 'active', 50, 100, 5, 10, 20);
insert into public.product_categories(product_id, category_id, is_primary) values
 ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', true) on conflict (product_id, category_id) do nothing;
insert into public.product_images(product_id, storage_path, alt_text, width, height, is_primary) values
 ('f2000000-0000-0000-0000-000000000001', 'test/variant-match.webp', 'Teste', 720, 720, true);
insert into public.product_variants(id, product_id, sku, color_name, color_hex, size, active) values
 ('f3000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'TEST-MATCH-W37', 'Branco', '#FFFFFF', '37', true),
 ('f3000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000001', 'TEST-MATCH-B38', 'Preto', '#171717', '38', true),
 ('f3000000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-000000000001', 'TEST-MATCH-B37', 'Preto', '#171717', '37', true),
 ('f3000000-0000-0000-0000-000000000004', 'f2000000-0000-0000-0000-000000000001', 'TEST-INACTIVE-99', 'Cinza Inativo', '#999999', '99', false),
 ('f3000000-0000-0000-0000-000000000005', 'f2000000-0000-0000-0000-000000000001', 'TEST-NOSTOCK-98', 'Sem Estoque', '#010203', '98', true);
insert into public.inventory(variant_id, available_quantity, reserved_quantity) values
 ('f3000000-0000-0000-0000-000000000001', 3, 0),
 ('f3000000-0000-0000-0000-000000000002', 2, 0),
 ('f3000000-0000-0000-0000-000000000003', 1, 1),
 ('f3000000-0000-0000-0000-000000000004', 5, 0),
 ('f3000000-0000-0000-0000-000000000005', 0, 0)
on conflict (variant_id) do update set available_quantity = excluded.available_quantity, reserved_quantity = excluded.reserved_quantity;

set local role anon;
select is((select option->>'hex' from jsonb_array_elements(public.search_catalog(p_category => 'teste-vitrine-variantes')->'facets'->'colors') option where option->>'value' = 'Branco'), '#FFFFFF', 'Facet preserva color_hex real');
select is((select count(*)::integer from jsonb_array_elements(public.search_catalog(p_category => 'teste-vitrine-variantes')->'facets'->'colors') option where option->>'value' = 'Cinza Inativo'), 0, 'Cor de variante inativa não aparece');
select is((select count(*)::integer from jsonb_array_elements(public.search_catalog(p_category => 'teste-vitrine-variantes')->'facets'->'colors') option where option->>'value' = 'Sem Estoque'), 0, 'Cor sem estoque líquido não aparece');
select is((select count(*)::integer from jsonb_array_elements(public.search_catalog(p_category => 'teste-vitrine-variantes')->'facets'->'sizes') option where option->>'value' = '98'), 0, 'Tamanho sem estoque líquido não aparece');
select is((public.search_catalog(p_category => 'teste-vitrine-variantes', p_colors => array['Preto'], p_sizes => array['37'])->>'total')::integer, 0, 'Não cruza Branco 37 com Preto 38 nem usa estoque reservado');
select is((public.search_catalog(p_category => 'teste-vitrine-variantes', p_colors => array['Preto'], p_sizes => array['38'])->>'total')::integer, 1, 'Encontra combinação realmente disponível');
select is((public.search_catalog(p_category => 'teste-vitrine-variantes')->>'total')::integer, 1, 'Sem filtros mantém a listagem original');
reset role;
insert into public.product_variants(id, product_id, sku, color_name, color_hex, size) values
 ('f3000000-0000-0000-0000-000000000006', 'f2000000-0000-0000-0000-000000000001', 'TEST-BEGE-39', 'Bege Strass', '#C7A77B', '39');
insert into public.inventory(variant_id, available_quantity, reserved_quantity) values
 ('f3000000-0000-0000-0000-000000000006', 4, 0);
set local role anon;
select is((select option->>'hex' from jsonb_array_elements(public.search_catalog(p_category => 'teste-vitrine-variantes')->'facets'->'colors') option where option->>'value' = 'Bege Strass'), '#C7A77B', 'Nova cor aparece automaticamente com seu HEX');
select is((select count(*)::integer from jsonb_array_elements(public.search_catalog(p_category => 'teste-vitrine-variantes')->'facets'->'sizes') option where option->>'value' = '39'), 1, 'Novo tamanho disponível aparece automaticamente');
select is((select (option->>'count')::integer from jsonb_array_elements(public.search_catalog(p_category => 'teste-vitrine-variantes')->'facets'->'colors') option where option->>'value' = 'Bege Strass'), 1, 'Count da cor corresponde ao resultado real');
select is((public.search_catalog(p_category => 'teste-vitrine-variantes', p_colors => array['Bege Strass'], p_sizes => array['38'])->>'total')::integer, 0, 'Cor e tamanho incompatíveis não geram resultado falso');
reset role;
update public.inventory set reserved_quantity = 0 where variant_id = 'f3000000-0000-0000-0000-000000000003';
set local role anon;
select is((public.search_catalog(p_category => 'teste-vitrine-variantes', p_colors => array['Preto'], p_sizes => array['37'])->>'total')::integer, 1, 'Combinação aparece quando estoque é liberado');
reset role;
update public.product_variants set active = false where id = 'f3000000-0000-0000-0000-000000000003';
set local role anon;
select is((public.search_catalog(p_category => 'teste-vitrine-variantes', p_colors => array['Preto'], p_sizes => array['37'])->>'total')::integer, 0, 'Variante inativa não satisfaz filtro');
reset role;
update public.products set status = 'archived' where id = 'f2000000-0000-0000-0000-000000000001';
set local role anon;
select is((public.search_catalog(p_category => 'teste-vitrine-variantes')->>'total')::integer, 0, 'Produto arquivado não aparece');
select is(jsonb_array_length(public.search_catalog(p_category => 'teste-vitrine-variantes')->'facets'->'colors'), 0, 'Produto arquivado não alimenta facets');
reset role;
select * from finish();
rollback;
