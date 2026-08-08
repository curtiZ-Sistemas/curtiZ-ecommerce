-- Corrige a semântica de saldo disponível e preserva a ordem paginada do catálogo.
-- reserve_inventory já move a quantidade de available_quantity para reserved_quantity;
-- portanto, leitores não podem subtrair reserved_quantity uma segunda vez.

grant select, insert, update on public.support_conversations to authenticated;
grant select, insert on public.support_messages to authenticated;
grant select, insert on public.support_attachments to authenticated;
grant select on public.support_participants to authenticated;

do $migration$
declare
  function_definition text;
  corrected_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.search_catalog(text,text,text,text[],text[],integer,integer,boolean,boolean,boolean,numeric,text,integer,integer)'::regprocedure
  ) into function_definition;

  corrected_definition := pg_catalog.replace(
    function_definition,
    'greatest(stock.available_quantity - stock.reserved_quantity, 0)',
    'greatest(stock.available_quantity, 0)'
  );
  if corrected_definition !~ E'greatest\\(\\s*stock\\.available_quantity\\s*,\\s*0\\s*\\)' then
    raise exception 'search_catalog stock expression is not supported by this migration';
  end if;
  if corrected_definition !~ E'''stock''\\s*,\\s*stock\\s*\\)\\s*order\\s+by\\s+case\\s+when\\s+p_sort\\s*=\\s*''price_asc''' then
    corrected_definition := pg_catalog.regexp_replace(
      corrected_definition,
      E'''stock''\\s*,\\s*stock\\s*\\)\\s*\\)\\s*from\\s+page_rows',
      E'''stock'', stock\n        )\n        order by\n          case when p_sort = ''price_asc'' then price_cents end asc,\n          case when p_sort = ''price_desc'' then price_cents end desc,\n          case when p_sort = ''newest'' then created_at end desc,\n          case when p_sort = ''best_sellers'' then sold_count end desc,\n          case when p_sort = ''rating'' then rating end desc,\n          case when p_sort = ''discount'' and compare_at_price_cents is not null\n            then 1 - (price_cents::numeric / compare_at_price_cents)\n          end desc,\n          case when p_sort = ''name_asc'' then name end asc,\n          case when p_sort = ''name_desc'' then name end desc,\n          featured desc, sold_count desc, created_at desc, id\n      )\n      from page_rows'
    );
  end if;
  if corrected_definition !~ E'''stock''\\s*,\\s*stock\\s*\\)\\s*order\\s+by\\s+case\\s+when\\s+p_sort\\s*=\\s*''price_asc''' then
    raise exception 'search_catalog aggregation is not supported by this migration';
  end if;
  if corrected_definition <> function_definition then execute corrected_definition; end if;

  select pg_catalog.pg_get_functiondef(
    'public.get_catalog_product(text)'::regprocedure
  ) into function_definition;
  corrected_definition := pg_catalog.replace(
    function_definition,
    'greatest(inventory.available_quantity - inventory.reserved_quantity, 0)',
    'greatest(inventory.available_quantity, 0)'
  );
  if corrected_definition !~ E'greatest\\(\\s*inventory\\.available_quantity\\s*,\\s*0\\s*\\)' then
    raise exception 'get_catalog_product stock expression is not supported by this migration';
  end if;
  if corrected_definition <> function_definition then execute corrected_definition; end if;

  select pg_catalog.pg_get_functiondef(
    'public.merge_customer_cart(jsonb,uuid)'::regprocedure
  ) into function_definition;
  corrected_definition := pg_catalog.replace(
    function_definition,
    'greatest(stock.available_quantity - stock.reserved_quantity, 0)',
    'greatest(stock.available_quantity, 0)'
  );
  corrected_definition := pg_catalog.replace(
    corrected_definition,
    'greatest(inventory.available_quantity - inventory.reserved_quantity, 0)',
    'greatest(inventory.available_quantity, 0)'
  );
  corrected_definition := pg_catalog.replace(
    corrected_definition,
    'stock.available_quantity > stock.reserved_quantity',
    'stock.available_quantity > 0'
  );
  if corrected_definition !~ E'greatest\\(\\s*(stock|inventory)\\.available_quantity\\s*,\\s*0\\s*\\)'
    or corrected_definition !~ E'stock\\.available_quantity\\s*>\\s*0' then
    raise exception 'merge_customer_cart stock expression is not supported by this migration';
  end if;
  if corrected_definition <> function_definition then execute corrected_definition; end if;

  select pg_catalog.pg_get_functiondef(
    'public.validate_checkout_lines(jsonb)'::regprocedure
  ) into function_definition;
  corrected_definition := pg_catalog.replace(
    function_definition,
    'greatest(stock.available_quantity - stock.reserved_quantity, 0)',
    'greatest(stock.available_quantity, 0)'
  );
  if corrected_definition !~ E'greatest\\(\\s*stock\\.available_quantity\\s*,\\s*0\\s*\\)' then
    raise exception 'validate_checkout_lines stock expression is not supported by this migration';
  end if;
  if corrected_definition <> function_definition then execute corrected_definition; end if;
end;
$migration$;
