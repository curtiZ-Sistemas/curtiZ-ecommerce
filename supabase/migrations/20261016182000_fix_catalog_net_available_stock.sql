-- Reservations already transfer units from available_quantity to reserved_quantity.
-- Later catalog migrations reintroduced subtraction in several readers. Patch
-- only those expressions, preserving current projections, grants and filters.
do $migration$
declare
  function_id pg_catalog.regprocedure;
  definition text;
  corrected text;
begin
  foreach function_id in array array[
    'public.get_catalog_product(text)'::pg_catalog.regprocedure,
    'public.get_google_merchant_feed()'::pg_catalog.regprocedure,
    'public.search_catalog(text,text,text,text[],text[],integer,integer,boolean,boolean,boolean,numeric,text,integer,integer)'::pg_catalog.regprocedure,
    'public.search_catalog_page(text,text,text,text[],text[],integer,integer,boolean,boolean,boolean,numeric,text,integer,integer)'::pg_catalog.regprocedure,
    'public.search_catalog_suggestions(text,integer)'::pg_catalog.regprocedure
  ] loop
    definition := pg_catalog.pg_get_functiondef(function_id);
    corrected := pg_catalog.replace(definition,
      'inventory.available_quantity - inventory.reserved_quantity', 'inventory.available_quantity');
    corrected := pg_catalog.replace(corrected,
      'stock.available_quantity - stock.reserved_quantity', 'stock.available_quantity');
    if corrected = definition or corrected ~ 'available_quantity[[:space:]]*-[[:space:]]*[a-zA-Z_][a-zA-Z_0-9]*\.reserved_quantity' then
      raise exception 'catalog stock reader changed; review net availability migration: %', function_id;
    end if;
    execute corrected;
  end loop;
end;
$migration$;
