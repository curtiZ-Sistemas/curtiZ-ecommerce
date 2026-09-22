begin;

-- Execucoes duraveis e jobs unitarios permitem que o navegador seja fechado sem
-- interromper as imagens. O Worker consumidor e o unico escritor dos jobs.
create table public.product_import_runs (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  products_total integer not null check (products_total between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.product_import_run_products (
  run_id uuid not null references public.product_import_runs(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (run_id, product_id)
);

create table public.product_import_image_jobs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  source_url text not null check (char_length(source_url) between 12 and 2048),
  normalized_url text not null check (char_length(normalized_url) between 12 and 2048),
  storage_path text not null unique check (storage_path ~ '^products/imports/[0-9a-f-]{36}/[a-f0-9]{64}\.webp$'),
  color_name text check (color_name is null or char_length(color_name) between 1 and 120),
  sort_order integer not null check (sort_order between 0 and 1000),
  is_primary boolean not null default false,
  apply_all_sizes boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  lock_token uuid,
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 80),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, normalized_url)
);

create table public.product_import_run_image_jobs (
  run_id uuid not null references public.product_import_runs(id) on delete cascade,
  job_id uuid not null references public.product_import_image_jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (run_id, job_id)
);

create index product_import_image_jobs_status_idx
  on public.product_import_image_jobs(status, updated_at);
create index product_import_run_image_jobs_job_idx
  on public.product_import_run_image_jobs(job_id);

alter table public.product_import_runs enable row level security;
alter table public.product_import_runs force row level security;
alter table public.product_import_run_products enable row level security;
alter table public.product_import_run_products force row level security;
alter table public.product_import_image_jobs enable row level security;
alter table public.product_import_image_jobs force row level security;
alter table public.product_import_run_image_jobs enable row level security;
alter table public.product_import_run_image_jobs force row level security;

revoke all on table public.product_import_runs from public, anon, authenticated;
revoke all on table public.product_import_run_products from public, anon, authenticated;
revoke all on table public.product_import_image_jobs from public, anon, authenticated;
revoke all on table public.product_import_run_image_jobs from public, anon, authenticated;

create or replace function public.admin_create_product_import_run(
  p_run_id uuid,
  p_products_total integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('products.create');
  perform private.require_permission('products.update');
  if p_products_total not between 0 and 100 or not exists (
    select 1 from public.product_import_sessions session
    where session.id = p_run_id and session.user_id = auth.uid() and session.expires_at > now()
  ) then
    raise exception 'invalid product import run' using errcode = '22023';
  end if;

  insert into public.product_import_runs(id, user_id, products_total)
  values (p_run_id, auth.uid(), p_products_total)
  on conflict (id) do update
    set products_total = excluded.products_total, updated_at = now()
    where product_import_runs.user_id = auth.uid();

  if not found then raise exception 'invalid product import run' using errcode = '42501'; end if;
  return jsonb_build_object('runId', p_run_id);
end;
$$;

revoke all on function public.admin_create_product_import_run(uuid, integer) from public, anon;
grant execute on function public.admin_create_product_import_run(uuid, integer) to authenticated;

create or replace function public.admin_enqueue_product_import_images(
  p_run_id uuid,
  p_product_id uuid,
  p_images jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  job_id uuid;
  job_status text;
  queued_ids jsonb := '[]'::jsonb;
begin
  perform private.require_permission('products.create');
  perform private.require_permission('products.update');
  if jsonb_typeof(p_images) <> 'array' or jsonb_array_length(p_images) > 1000
     or not exists (select 1 from public.product_import_runs run where run.id = p_run_id and run.user_id = auth.uid())
     or not exists (select 1 from public.products product where product.id = p_product_id) then
    raise exception 'invalid product image jobs' using errcode = '22023';
  end if;

  insert into public.product_import_run_products(run_id, product_id)
  values (p_run_id, p_product_id) on conflict do nothing;

  for item in
    select value, ordinality
    from jsonb_array_elements(p_images) with ordinality source(value, ordinality)
  loop
    if jsonb_typeof(item.value) <> 'object'
       or coalesce(item.value->>'sourceUrl', '') !~ '^https://down-sg\.img\.susercontent\.com/'
       or coalesce(item.value->>'normalizedUrl', '') !~ '^https://down-sg\.img\.susercontent\.com/'
       or coalesce(item.value->>'storagePath', '') !~ ('^products/imports/' || p_product_id::text || '/[a-f0-9]{64}\.webp$')
       or coalesce((item.value->>'sortOrder')::integer, -1) not between 0 and 1000 then
      raise exception 'invalid product image job' using errcode = '22023';
    end if;

    insert into public.product_import_image_jobs(
      product_id, source_url, normalized_url, storage_path, color_name,
      sort_order, is_primary, apply_all_sizes
    ) values (
      p_product_id, item.value->>'sourceUrl', item.value->>'normalizedUrl', item.value->>'storagePath',
      nullif(trim(item.value->>'colorName'), ''), (item.value->>'sortOrder')::integer,
      coalesce((item.value->>'isPrimary')::boolean, false),
      coalesce((item.value->>'applyAllSizes')::boolean, false)
    )
    on conflict (product_id, normalized_url) do update set
      source_url = excluded.source_url,
      storage_path = excluded.storage_path,
      color_name = excluded.color_name,
      sort_order = excluded.sort_order,
      is_primary = excluded.is_primary,
      apply_all_sizes = excluded.apply_all_sizes,
      status = case when exists (
        select 1 from public.product_images image
        join public.product_media media on media.id = image.id and media.storage_path = image.storage_path
        where image.product_id = p_product_id and image.storage_path = excluded.storage_path
      ) then 'completed'
      when product_import_image_jobs.status = 'processing'
        and product_import_image_jobs.updated_at > now() - interval '45 seconds' then 'processing'
      else 'queued' end,
      attempts = case when product_import_image_jobs.status = 'failed' then 0 else product_import_image_jobs.attempts end,
      lock_token = null,
      last_error_code = null,
      completed_at = case when exists (
        select 1 from public.product_images image
        join public.product_media media on media.id = image.id and media.storage_path = image.storage_path
        where image.product_id = p_product_id and image.storage_path = excluded.storage_path
      ) then coalesce(product_import_image_jobs.completed_at, now()) else null end,
      updated_at = now()
    returning id, status into job_id, job_status;

    insert into public.product_import_run_image_jobs(run_id, job_id)
    values (p_run_id, job_id) on conflict do nothing;
    if job_status = 'queued' then queued_ids := queued_ids || to_jsonb(job_id); end if;
  end loop;

  update public.product_import_runs set updated_at = now(), completed_at = null where id = p_run_id;
  return jsonb_build_object('jobIds', queued_ids, 'queued', jsonb_array_length(queued_ids));
end;
$$;

revoke all on function public.admin_enqueue_product_import_images(uuid, uuid, jsonb) from public, anon;
grant execute on function public.admin_enqueue_product_import_images(uuid, uuid, jsonb) to authenticated;

create or replace function public.get_product_import_status(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  finished boolean;
begin
  perform private.require_permission('products.create');
  perform private.require_permission('products.update');
  if not exists (select 1 from public.product_import_runs run where run.id = p_run_id and run.user_id = auth.uid()) then
    raise exception 'product import run not found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'runId', run.id,
    'productsTotal', run.products_total,
    'productsSaved', products.saved,
    'imagesTotal', images.total,
    'imagesQueued', images.queued,
    'imagesProcessing', images.processing,
    'imagesCompleted', images.completed,
    'imagesFailed', images.failed,
    'done', products.saved >= run.products_total and images.queued + images.processing = 0
  ) into result
  from public.product_import_runs run
  cross join lateral (
    select count(*)::integer as saved
    from public.product_import_run_products product where product.run_id = run.id
  ) products
  cross join lateral (
    select count(*)::integer as total,
      count(*) filter (where job.status = 'queued')::integer as queued,
      count(*) filter (where job.status = 'processing')::integer as processing,
      count(*) filter (where job.status = 'completed')::integer as completed,
      count(*) filter (where job.status = 'failed')::integer as failed
    from public.product_import_run_image_jobs link
    join public.product_import_image_jobs job on job.id = link.job_id
    where link.run_id = run.id
  ) images
  where run.id = p_run_id;

  finished := coalesce((result->>'done')::boolean, false);
  update public.product_import_runs
  set updated_at = now(), completed_at = case when finished then coalesce(completed_at, now()) else null end
  where id = p_run_id;
  return result;
end;
$$;

revoke all on function public.get_product_import_status(uuid) from public, anon;
grant execute on function public.get_product_import_status(uuid) to authenticated;

create or replace function public.claim_product_import_image_job(p_job_id uuid, p_lock_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.product_import_image_jobs%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into job from public.product_import_image_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('state', 'missing'); end if;
  if job.status = 'completed' then return jsonb_build_object('state', 'completed'); end if;
  if job.status = 'failed' or job.attempts >= 5 then return jsonb_build_object('state', 'failed'); end if;
  if job.status = 'processing' and job.updated_at > now() - interval '45 seconds' then
    return jsonb_build_object('state', 'busy');
  end if;

  update public.product_import_image_jobs set
    status = 'processing', attempts = attempts + 1, lock_token = p_lock_token,
    started_at = now(), updated_at = now(), last_error_code = null
  where id = p_job_id;
  return jsonb_build_object(
    'state', 'claimed', 'jobId', job.id, 'productId', job.product_id,
    'sourceUrl', job.source_url, 'storagePath', job.storage_path,
    'colorName', job.color_name, 'sortOrder', job.sort_order,
    'isPrimary', job.is_primary, 'applyAllSizes', job.apply_all_sizes,
    'attempt', job.attempts + 1
  );
end;
$$;

create or replace function private.reconcile_product_import_primary(p_product_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare desired_path text;
begin
  select job.storage_path into desired_path
  from public.product_import_image_jobs job
  where job.product_id = p_product_id and job.status = 'completed'
  order by job.is_primary desc, job.sort_order, job.id
  limit 1;
  if desired_path is null then return; end if;
  update public.product_images set is_primary = (storage_path = desired_path) where product_id = p_product_id;
  update public.product_media set is_primary = (storage_path = desired_path) where product_id = p_product_id and media_type = 'image';
end;
$$;

revoke all on function private.reconcile_product_import_primary(uuid) from public, anon, authenticated;

create or replace function public.complete_product_import_image_job(
  p_job_id uuid,
  p_lock_token uuid,
  p_width integer,
  p_height integer,
  p_size_bytes bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.product_import_image_jobs%rowtype;
  image_id uuid;
  variant_id uuid;
  product_name text;
begin
  if auth.role() <> 'service_role' then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_width not between 1 and 12000 or p_height not between 1 and 12000
     or p_width::bigint * p_height::bigint > 40000000 or p_size_bytes not between 1 and 10485760 then
    raise exception 'invalid processed image metadata' using errcode = '22023';
  end if;
  select * into job from public.product_import_image_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('state', 'missing'); end if;
  if job.status = 'completed' then return jsonb_build_object('state', 'completed'); end if;
  if job.status <> 'processing' or job.lock_token is distinct from p_lock_token then
    return jsonb_build_object('state', 'stale');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('product-import-images:' || job.product_id::text, 0));
  select product.name into product_name from public.products product where product.id = job.product_id;
  if job.color_name is not null then
    select variant.id into variant_id from public.product_variants variant
    where variant.product_id = job.product_id and lower(trim(variant.color_name)) = lower(trim(job.color_name))
    order by variant.created_at, variant.id limit 1;
  end if;

  insert into public.product_images(product_id, variant_id, storage_path, alt_text, sort_order, is_primary, width, height)
  values (job.product_id, variant_id, job.storage_path,
    product_name || case when job.color_name is null then '' else ' - ' || job.color_name end,
    job.sort_order, false, p_width, p_height)
  on conflict (storage_path) do update set
    variant_id = excluded.variant_id, alt_text = excluded.alt_text, sort_order = excluded.sort_order,
    width = excluded.width, height = excluded.height
  returning id into image_id;

  insert into public.product_media(id, product_id, variant_id, media_type, storage_path, thumbnail_path,
    alt_text, mime_type, size_bytes, sort_order, is_primary, created_by)
  values (image_id, job.product_id, variant_id, 'image', job.storage_path, null,
    product_name || case when job.color_name is null then '' else ' - ' || job.color_name end,
    'image/webp', p_size_bytes, job.sort_order, false, null)
  on conflict (storage_path) do update set
    variant_id = excluded.variant_id, alt_text = excluded.alt_text, mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes, sort_order = excluded.sort_order;

  update public.product_import_image_jobs set status = 'completed', lock_token = null,
    completed_at = now(), updated_at = now(), last_error_code = null where id = p_job_id;
  perform private.reconcile_product_import_primary(job.product_id);
  return jsonb_build_object('state', 'completed');
end;
$$;

create or replace function public.fail_product_import_image_job(
  p_job_id uuid,
  p_lock_token uuid,
  p_error_code text,
  p_retryable boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare job public.product_import_image_jobs%rowtype; should_retry boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into job from public.product_import_image_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('retry', false, 'state', 'missing'); end if;
  if job.status = 'completed' then return jsonb_build_object('retry', false, 'state', 'completed'); end if;
  if job.status <> 'processing' or job.lock_token is distinct from p_lock_token then
    return jsonb_build_object('retry', false, 'state', 'stale');
  end if;
  should_retry := coalesce(p_retryable, false) and job.attempts < 5;
  update public.product_import_image_jobs set status = case when should_retry then 'queued' else 'failed' end,
    lock_token = null, last_error_code = left(coalesce(nullif(p_error_code, ''), 'IMAGE_FAILED'), 80),
    completed_at = case when should_retry then null else now() end, updated_at = now()
  where id = p_job_id;
  if not should_retry then perform private.reconcile_product_import_primary(job.product_id); end if;
  return jsonb_build_object('retry', should_retry, 'exhausted', coalesce(p_retryable, false) and not should_retry,
    'state', case when should_retry then 'queued' else 'failed' end);
end;
$$;

revoke all on function public.claim_product_import_image_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_product_import_image_job(uuid, uuid, integer, integer, bigint) from public, anon, authenticated;
revoke all on function public.fail_product_import_image_job(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_product_import_image_job(uuid, uuid) to service_role;
grant execute on function public.complete_product_import_image_job(uuid, uuid, integer, integer, bigint) to service_role;
grant execute on function public.fail_product_import_image_job(uuid, uuid, text, boolean) to service_role;

notify pgrst, 'reload schema';
commit;
