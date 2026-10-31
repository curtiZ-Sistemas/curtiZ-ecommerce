-- Operational product data is private and entered only after an authorized review.
-- This migration creates no commercial data and enables no provider operation.
create table private.bling_catalog_metadata (
  product_id uuid primary key references public.products(id) on delete cascade,
  commercial_unit text not null check (commercial_unit in ('PR','UN','KIT')),
  pairs_per_sku integer not null check (pairs_per_sku between 1 and 100),
  ncm text not null check (ncm ~ '^[0-9]{8}$'),
  origin integer not null check (origin between 0 and 8),
  cest text not null default '' check (cest = '' or cest ~ '^[0-9]{7}$'),
  production_type text not null check (production_type in ('P','T')),
  fiscal_unit_approved boolean not null default false,
  evidence_reference text not null check (length(evidence_reference) between 10 and 200),
  updated_at timestamptz not null default now()
);
alter table private.bling_catalog_metadata enable row level security;
alter table private.bling_catalog_metadata force row level security;
revoke all on private.bling_catalog_metadata from public, anon, authenticated;

alter table private.bling_product_links add column last_stock_cost numeric(12,2) check (last_stock_cost>=0);
create or replace function public.mark_bling_stock_cost_synced(p_variant_id uuid,p_expected_version integer,p_expected_quantity integer,p_expected_cost numeric)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.bling_product_links link set local_version=i.version,last_stock_cost=p_expected_cost,last_synced_at=now()
  from public.inventory i join public.product_variants v on v.id=i.variant_id join public.products p on p.id=v.product_id
  where link.variant_id=p_variant_id and i.variant_id=p_variant_id and i.version>=p_expected_version
    and i.available_quantity+i.reserved_quantity=p_expected_quantity and coalesce(v.cost_override,p.cost_price)=p_expected_cost;
  return found;
end;
$$;
revoke all on function public.mark_bling_stock_cost_synced(uuid,integer,integer,numeric) from public,anon,authenticated;
grant execute on function public.mark_bling_stock_cost_synced(uuid,integer,integer,numeric) to service_role;

create or replace function public.read_bling_catalog_variant(p_variant_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('variant',to_jsonb(v),'product',jsonb_build_object(
    'id',p.id,'name',p.name,'status',p.status,'base_price',p.base_price,'cost_price',p.cost_price,
    'short_description',p.short_description,'weight_grams',p.weight_grams,'height_cm',p.height_cm,
    'width_cm',p.width_cm,'length_cm',p.length_cm),
    'inventory',to_jsonb(i),'metadata',to_jsonb(m),
    'imagePaths',coalesce((select jsonb_agg(images.storage_path order by images.priority,images.sort_order,images.id)
      from (select image.id,image.storage_path,image.sort_order,
        case when image.variant_id=v.id then 0 when image.variant_id is not null then 1 else 2 end priority
        from public.product_images image left join public.product_variants image_variant on image_variant.id=image.variant_id
        where image.product_id=p.id and (image.variant_id is null or image.variant_id=v.id
          or image_variant.color_name=v.color_name)
        order by priority,image.is_primary desc,image.sort_order,image.id limit 10) images),'[]'::jsonb))
  from public.product_variants v join public.products p on p.id=v.product_id
  left join public.inventory i on i.variant_id=v.id
  left join private.bling_catalog_metadata m on m.product_id=p.id where v.id=p_variant_id;
$$;
revoke all on function public.read_bling_catalog_variant(uuid) from public, anon, authenticated;
grant execute on function public.read_bling_catalog_variant(uuid) to service_role;

-- A bounded manual catalogue batch shares the same global lease as the cron.
-- It can never claim a sale, invoice, email or webhook job.
create or replace function public.claim_bling_catalog_job(p_lock_id uuid,p_create_enabled boolean,
  p_product_enabled boolean,p_stock_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare selected public.background_jobs%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('bling-job-claim'));
  with expired as (
    update public.background_jobs set status='failed',error_summary='lease_expired_reconciliation_required',locked_at=null,lock_id=null
    where queue='bling' and job_type in ('bling.product.create','bling.product.sync','bling.product.reconcile','bling.stock.sync')
      and status='running' and locked_at<now()-interval '5 minutes' and attempts>=5 returning id,attempts
  ) insert into private.bling_job_history(job_id,attempt,outcome,error_code)
    select id,attempts,'failed','lease_expired_reconciliation_required' from expired;
  if exists(select 1 from public.background_jobs where queue='bling' and status='running'
    and locked_at>=now()-interval '5 minutes') then return null; end if;
  select * into selected from public.background_jobs where queue='bling'
    and ((job_type='bling.product.create' and p_create_enabled)
      or (job_type='bling.product.sync' and p_product_enabled)
      or job_type='bling.product.reconcile'
      or (job_type='bling.stock.sync' and p_stock_enabled))
    and ((status='pending' and available_at<=now()) or (status='running' and locked_at<now()-interval '5 minutes'))
    order by available_at,id for update skip locked limit 1;
  if selected.id is null then return null; end if;
  update public.background_jobs set status='running',attempts=attempts+1,locked_at=now(),lock_id=p_lock_id,
    error_summary=null where id=selected.id;
  return jsonb_build_object('id',selected.id,'jobType',selected.job_type,'payload',selected.payload_sanitized,'attempts',selected.attempts+1);
end;
$$;
revoke all on function public.claim_bling_catalog_job(uuid,boolean,boolean,boolean) from public, anon, authenticated;
grant execute on function public.claim_bling_catalog_job(uuid,boolean,boolean,boolean) to service_role;

-- Reuse existing enqueue logic, including CAS timestamps, when costs/images change.
create or replace function private.enqueue_bling_variant_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from private.bling_product_links where variant_id=new.id) then return new; end if;
  if tg_op='UPDATE' and (new.sku,new.color_name,new.size,new.price_override,new.cost_override,new.active,new.barcode)
    is not distinct from (old.sku,old.color_name,old.size,old.price_override,old.cost_override,old.active,old.barcode) then return new; end if;
  update private.bling_product_links set sync_status='pending',updated_at=now() where variant_id=new.id;
  insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
  values('bling','bling.product.sync',jsonb_build_object('variantId',new.id),
    'bling:product:' || new.id::text || ':' || extract(epoch from clock_timestamp())::text) on conflict(idempotency_key) do nothing;
  if tg_op='UPDATE' and new.cost_override is distinct from old.cost_override then
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling','bling.stock.sync',jsonb_build_object('variantId',new.id),
      'bling:cost:' || new.id::text || ':' || extract(epoch from clock_timestamp())::text) on conflict(idempotency_key) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.enqueue_bling_variant_change() from public,anon,authenticated;

create or replace function private.enqueue_bling_product_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if tg_op='UPDATE' and (new.name,new.status,new.base_price,new.cost_price,new.short_description,new.weight_grams,new.height_cm,new.width_cm,new.length_cm)
    is not distinct from (old.name,old.status,old.base_price,old.cost_price,old.short_description,old.weight_grams,old.height_cm,old.width_cm,old.length_cm)
    then return new; end if;
  for v_id in select link.variant_id from private.bling_product_links link
    join public.product_variants v on v.id=link.variant_id where v.product_id=new.id loop
    update private.bling_product_links set sync_status='pending',updated_at=now() where variant_id=v_id;
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling','bling.product.sync',jsonb_build_object('variantId',v_id),
      'bling:product:' || v_id::text || ':' || extract(epoch from clock_timestamp())::text) on conflict(idempotency_key) do nothing;
    if new.cost_price is distinct from old.cost_price then
      insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
      values('bling','bling.stock.sync',jsonb_build_object('variantId',v_id),
        'bling:cost:' || v_id::text || ':' || extract(epoch from clock_timestamp())::text) on conflict(idempotency_key) do nothing;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.enqueue_bling_product_change() from public,anon,authenticated;

create or replace function private.enqueue_bling_catalog_media_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare product_ids uuid[]; v_id uuid;
begin
  product_ids := case when tg_op='INSERT' then array[new.product_id]
    when tg_op='DELETE' then array[old.product_id] else array[old.product_id,new.product_id] end;
  for v_id in select link.variant_id from private.bling_product_links link
    join public.product_variants v on v.id=link.variant_id where v.product_id=any(product_ids) loop
    update private.bling_product_links set sync_status='pending',updated_at=now() where variant_id=v_id;
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling','bling.product.sync',jsonb_build_object('variantId',v_id),
      'bling:media:' || v_id::text || ':' || extract(epoch from clock_timestamp())::text) on conflict(idempotency_key) do nothing;
  end loop;
  return null;
end;
$$;
revoke all on function private.enqueue_bling_catalog_media_change() from public,anon,authenticated;
create trigger enqueue_bling_image_change after insert or update or delete on public.product_images
  for each row execute function private.enqueue_bling_catalog_media_change();
create trigger enqueue_bling_metadata_change after insert or update or delete on private.bling_catalog_metadata
  for each row execute function private.enqueue_bling_catalog_media_change();
