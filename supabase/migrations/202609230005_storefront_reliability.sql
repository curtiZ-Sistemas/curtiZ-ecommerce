begin;

-- Keep active workers locked long enough for bounded download/transform/upload work.
do $migration$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.admin_enqueue_product_import_images(uuid,uuid,jsonb)'::pg_catalog.regprocedure
  ) into definition;
  if definition is null
    or pg_catalog.strpos(definition, 'status = case when exists (') = 0
    or pg_catalog.strpos(definition, 'lock_token = null,') = 0
    or pg_catalog.strpos(definition, 'interval ''45 seconds''') = 0 then
    raise exception 'product image enqueue definition changed; review queue recovery migration';
  end if;
  definition := pg_catalog.replace(definition, 'status = case when exists (',
    'status = case when product_import_image_jobs.status = ''completed'' then ''completed'' when exists (');
  definition := pg_catalog.replace(definition, 'interval ''45 seconds''', 'interval ''5 minutes''');
  definition := pg_catalog.replace(definition, 'lock_token = null,',
    'lock_token = case when product_import_image_jobs.status = ''processing''
        and product_import_image_jobs.updated_at > now() - interval ''5 minutes''
        then product_import_image_jobs.lock_token else null end,');
  execute definition;

  select pg_catalog.pg_get_functiondef(
    'public.claim_product_import_image_job(uuid,uuid)'::pg_catalog.regprocedure
  ) into definition;
  if definition is null or pg_catalog.strpos(definition, 'interval ''45 seconds''') = 0 then
    raise exception 'product image claim definition changed; review queue recovery migration';
  end if;
  definition := pg_catalog.replace(definition, 'interval ''45 seconds''', 'interval ''5 minutes''');
  execute definition;
end;
$migration$;

create or replace function public.get_product_import_status(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  queue_jobs jsonb := '[]'::jsonb;
  stale_jobs jsonb := '[]'::jsonb;
  run public.product_import_runs%rowtype;
  finished boolean;
begin
  perform private.require_permission('products.create');
  perform private.require_permission('products.update');
  select * into run from public.product_import_runs item
  where item.id = p_run_id and item.user_id = auth.uid() for update;
  if not found then raise exception 'product import run not found' using errcode = 'P0002'; end if;

  with candidates as materialized (
    select job.id
    from public.product_import_run_image_jobs link
    join public.product_import_image_jobs job on job.id = link.job_id
    where link.run_id = p_run_id and job.status = 'processing'
      and job.updated_at <= now() - interval '5 minutes' and job.attempts >= 5
    order by job.updated_at, job.id
    limit 100
    for update of job skip locked
  )
  update public.product_import_image_jobs job set
    status = 'failed', lock_token = null, started_at = null,
    last_error_code = 'WORKER_ABANDONED_MAX_ATTEMPTS', completed_at = now(), updated_at = now()
  from candidates where job.id = candidates.id;

  with candidates as materialized (
    select job.id
    from public.product_import_run_image_jobs link
    join public.product_import_image_jobs job on job.id = link.job_id
    where link.run_id = p_run_id and job.status = 'processing'
      and job.updated_at <= now() - interval '5 minutes' and job.attempts < 5
    order by job.updated_at, job.id
    limit 100
    for update of job skip locked
  ), recovered as (
    update public.product_import_image_jobs job set
      status = 'queued', lock_token = null, started_at = null, last_error_code = null,
      completed_at = null, updated_at = now()
    from candidates where job.id = candidates.id
    returning job.id, job.product_id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'jobId', id, 'productId', product_id)), '[]'::jsonb)
  into stale_jobs from recovered;

  with candidates as materialized (
    select job.id
    from public.product_import_run_image_jobs link
    join public.product_import_image_jobs job on job.id = link.job_id
    where link.run_id = p_run_id and job.status = 'queued'
      and job.updated_at <= now() - interval '45 seconds'
    order by job.updated_at, job.id
    limit 100
    for update of job skip locked
  ), dispatched as (
    update public.product_import_image_jobs job set updated_at = now()
    from candidates where job.id = candidates.id and job.status = 'queued'
    returning job.id, job.product_id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'jobId', id, 'productId', product_id)), '[]'::jsonb)
  into queue_jobs from dispatched;
  queue_jobs := stale_jobs || queue_jobs;

  select pg_catalog.jsonb_build_object(
    'runId', item.id,
    'productsTotal', item.products_total,
    'productsSaved', products.saved,
    'imagesTotal', images.total,
    'imagesQueued', images.queued,
    'imagesProcessing', images.processing,
    'imagesCompleted', images.completed,
    'imagesFailed', images.failed,
    'done', products.saved >= item.products_total and images.queued + images.processing = 0,
    'queueJobs', queue_jobs
  ) into result
  from public.product_import_runs item
  cross join lateral (
    select count(*)::integer as saved
    from public.product_import_run_products linked where linked.run_id = item.id
  ) products
  cross join lateral (
    select count(*)::integer as total,
      count(*) filter (where job.status = 'queued')::integer as queued,
      count(*) filter (where job.status = 'processing')::integer as processing,
      count(*) filter (where job.status = 'completed')::integer as completed,
      count(*) filter (where job.status = 'failed')::integer as failed
    from public.product_import_run_image_jobs link
    join public.product_import_image_jobs job on job.id = link.job_id
    where link.run_id = item.id
  ) images
  where item.id = p_run_id;

  finished := coalesce((result->>'done')::boolean, false);
  update public.product_import_runs
  set updated_at = now(), completed_at = case when finished then coalesce(completed_at, now()) else null end
  where id = p_run_id;
  return result;
end;
$$;

revoke all on function public.get_product_import_status(uuid) from public, anon;
grant execute on function public.get_product_import_status(uuid) to authenticated;

-- Keep second-page queries on the same catalog rules without recalculating facets.
create or replace function public.search_catalog_page(
  p_query text default null, p_category text default null, p_collection text default null,
  p_colors text[] default '{}'::text[], p_sizes text[] default '{}'::text[],
  p_price_min integer default null, p_price_max integer default null,
  p_promotion boolean default false, p_in_stock boolean default false,
  p_featured boolean default false, p_min_rating numeric default null,
  p_sort text default 'relevant', p_page integer default 1, p_page_size integer default 12
) returns jsonb language sql stable security definer set search_path = '' as $$
  with product_data as (
    select item.* from private.storefront_catalog_items() item
    where (nullif(pg_catalog.btrim(p_query), '') is null
      or pg_catalog.to_tsvector('simple', pg_catalog.concat_ws(' ', item.base_name,
        item.description, item.category, item.variant_color, item.variant_size, item.sku))
        @@ pg_catalog.websearch_to_tsquery('simple', pg_catalog.btrim(p_query))
      or pg_catalog.concat_ws(' ', item.base_name, item.variant_color, item.variant_size, item.sku)
        ilike ('%' || pg_catalog.btrim(p_query) || '%'))
      and (nullif(pg_catalog.btrim(p_category), '') is null or exists (
        select 1 from public.product_categories link
        join public.categories category on category.id = link.category_id and category.active
        where link.product_id = item.product_id
          and (pg_catalog.lower(category.slug) = pg_catalog.lower(pg_catalog.btrim(p_category))
            or pg_catalog.lower(category.name) = pg_catalog.lower(pg_catalog.btrim(p_category)))
      ))
      and (nullif(pg_catalog.btrim(p_collection), '') is null
        or pg_catalog.lower(item.collection_slug) = pg_catalog.lower(pg_catalog.btrim(p_collection)))
  ), scoped as (
    select * from product_data item
    where (p_price_min is null or item.price_cents >= p_price_min)
      and (p_price_max is null or item.price_cents <= p_price_max)
      and (not p_promotion or item.compare_at_price_cents is not null)
      and (not p_in_stock or item.stock > 0)
      and (not p_featured or item.featured)
      and (p_min_rating is null or item.rating >= p_min_rating)
  ), filtered as (
    select * from scoped item
    where (pg_catalog.cardinality(p_colors) = 0 and pg_catalog.cardinality(p_sizes) = 0)
      or exists (
        select 1 from public.product_variants variant
        join public.inventory inventory on inventory.variant_id = variant.id
        where variant.product_id = item.product_id and variant.active
          and (pg_catalog.cardinality(item.colors) = 0 or variant.color_name = any(item.colors))
          and inventory.available_quantity - inventory.reserved_quantity > 0
          and (pg_catalog.cardinality(p_colors) = 0 or exists (
            select 1 from pg_catalog.unnest(p_colors) requested(color)
            where pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(variant.color_name, '[[:space:]]+', ' ', 'g')))
              = pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(requested.color, '[[:space:]]+', ' ', 'g')))
          ))
          and (pg_catalog.cardinality(p_sizes) = 0 or variant.size = any(p_sizes))
      )
  ), ordered as (
    select item.*, pg_catalog.row_number() over(order by
      case when p_sort = 'price_asc' then item.price_cents end asc,
      case when p_sort = 'price_desc' then item.price_cents end desc,
      case when p_sort = 'newest' then item.created_at end desc,
      case when p_sort = 'best_sellers' then item.sold_count end desc,
      case when p_sort = 'rating' then item.rating end desc,
      case when p_sort = 'discount' and item.compare_at_price_cents is not null
        then 1 - (item.price_cents::numeric / item.compare_at_price_cents) end desc,
      case when p_sort = 'name_asc' then item.display_name end asc,
      case when p_sort = 'name_desc' then item.display_name end desc,
      item.featured desc, item.sold_count desc, item.created_at desc,
      item.product_id, item.image_path
    ) as display_position from filtered item
  ), page_rows as (
    select * from ordered order by display_position
    limit greatest(1, least(p_page_size, 48))
    offset ((greatest(1, least(p_page, 500)) - 1) * greatest(1, least(p_page_size, 48)))
  )
  select pg_catalog.jsonb_build_object(
    'products', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', product_id, 'storefrontKey', storefront_key, 'variantId', variant_id,
      'sku', sku, 'variantColor', variant_color, 'variantSize', variant_size,
      'slug', slug, 'name', display_name, 'category', category, 'categorySlug', category_slug,
      'description', description, 'priceInCents', price_cents,
      'compareAtPriceInCents', compare_at_price_cents, 'rating', rating,
      'reviews', reviews, 'colors', colors, 'sizes', sizes,
      'imagePath', image_path, 'featured', featured, 'stock', stock
    ) order by display_position) from page_rows), '[]'::jsonb),
    'total', (select pg_catalog.count(*) from filtered)
  );
$$;

revoke all on function public.search_catalog_page(text,text,text,text[],text[],integer,integer,boolean,boolean,boolean,numeric,text,integer,integer) from public;
grant execute on function public.search_catalog_page(text,text,text,text[],text[],integer,integer,boolean,boolean,boolean,numeric,text,integer,integer) to anon, authenticated;

-- Keep two-tone swatch data in the catalog facet response instead of a second global query.
do $migration$
declare
  definition text;
  old_json text := $old$pg_catalog.jsonb_build_object('value', color, 'label', color, 'count', amount)
        || case when hex is null then '{}'::jsonb else pg_catalog.jsonb_build_object('hex', hex) end$old$;
  new_json text := $new$pg_catalog.jsonb_build_object('value', color, 'label', color, 'count', amount)
        || case when hex is null then '{}'::jsonb else pg_catalog.jsonb_build_object('hex', hex) end
        || case when secondary_hex is null then '{}'::jsonb
          else pg_catalog.jsonb_build_object('secondaryHex', secondary_hex) end$new$;
  old_aggregate text := 'pg_catalog.min(color) color, pg_catalog.max(hex) hex,';
  old_candidate text := $old$then pg_catalog.btrim(variant.color_hex::text) end hex
        from scoped item
        join public.product_variants variant$old$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.search_catalog(text,text,text,text[],text[],integer,integer,boolean,boolean,boolean,numeric,text,integer,integer)'::pg_catalog.regprocedure
  ) into definition;
  if definition is null or pg_catalog.strpos(definition, old_json) = 0
    or pg_catalog.strpos(definition, old_aggregate) = 0
    or pg_catalog.strpos(definition, old_candidate) = 0 then
    raise exception 'catalog color facet definition changed; review secondary color facet migration';
  end if;
  definition := pg_catalog.replace(definition, old_json, new_json);
  definition := pg_catalog.replace(definition, old_aggregate,
    'pg_catalog.min(color) color, pg_catalog.max(hex) hex, pg_catalog.max(secondary_hex) secondary_hex,');
  definition := pg_catalog.replace(definition, old_candidate,
    $new$then pg_catalog.btrim(variant.color_hex::text) end hex,
          case when pg_catalog.btrim(variant.color_hex_secondary::text) ~ '^#[0-9A-Fa-f]{6}$'
            then pg_catalog.btrim(variant.color_hex_secondary::text) end secondary_hex
        from scoped item
        join public.product_variants variant$new$);
  execute definition;
end;
$migration$;

-- The existing category/menu sync has one ambiguous column in its final cleanup update.
do $migration$
declare
  definition text;
  old_cleanup text := $old$update public.store_navigation_items set visible = false, updated_by = auth.uid(), updated_at = now()
  where source = 'xlsx_config' and not (source_key = any(seen_keys)) and visible;$old$;
  new_cleanup text := $new$update public.store_navigation_items as navigation
  set visible = false, updated_by = auth.uid(), updated_at = now()
  where navigation.source = 'xlsx_config'
    and not (navigation.source_key = any(seen_keys)) and navigation.visible;$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.admin_sync_store_navigation(jsonb,jsonb,boolean)'::pg_catalog.regprocedure
  ) into definition;
  if definition is null or pg_catalog.strpos(definition, old_cleanup) = 0 then
    raise exception 'store navigation sync definition changed; review incremental repair';
  end if;
  execute pg_catalog.replace(definition, old_cleanup, new_cleanup);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
