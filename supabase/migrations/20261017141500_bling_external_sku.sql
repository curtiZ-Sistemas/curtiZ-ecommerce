-- Bling's SKU input is limited to 60 characters and silently truncates longer
-- API values. Preserve local SKUs and external IDs; use a stable UUID alias only
-- when the original does not fit. Existing truncated records require explicit
-- provider verification before any write or stock synchronization.
alter table private.bling_product_links add column external_sku text;
update private.bling_product_links set external_sku=case when length(sku)<=60 then sku
  else 'CZ-'||replace(variant_id::text,'-','') end;
alter table private.bling_product_links alter column external_sku set not null;
alter table private.bling_product_links add constraint bling_external_sku_length check(length(external_sku) between 1 and 60);
create unique index bling_external_sku_unique on private.bling_product_links(lower(external_sku));

create or replace function public.mark_bling_product_status(p_variant_id uuid,p_status text,p_sku text,
  p_expected_updated_at timestamptz,p_error_code text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('synced','failed','reconciliation_required') then raise exception 'invalid_status'; end if;
  update private.bling_product_links set sync_status=p_status,
    sku=case when p_status='synced' then p_sku else sku end,
    external_sku=case when p_status<>'synced' then external_sku when length(p_sku)<=60 then p_sku else 'CZ-'||replace(p_variant_id::text,'-','') end,
    last_error_code=case when p_status='synced' then null else left(p_error_code,120) end,
    last_synced_at=case when p_status='synced' then now() else last_synced_at end,updated_at=now()
  where variant_id=p_variant_id and updated_at=p_expected_updated_at;
  return found;
end;
$$;

create or replace function public.match_bling_products(p_matches jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare entry jsonb; matching_variant public.product_variants%rowtype; external_id bigint; matched integer := 0;
  existing_id bigint; provider_sku text;
begin
  if jsonb_typeof(p_matches)<>'array' or jsonb_array_length(p_matches)>100 then raise exception 'invalid_matches'; end if;
  for entry in select value from jsonb_array_elements(p_matches) loop
    external_id := (entry->>'externalProductId')::bigint;
    if external_id<=0 then raise exception 'invalid_external_id'; end if;
    select * into matching_variant from public.product_variants where sku=(entry->>'sku')::extensions.citext for update;
    if matching_variant.id is null then raise exception 'sku_missing'; end if;
    provider_sku:=case when length(matching_variant.sku::text)<=60 then matching_variant.sku::text
      else 'CZ-'||replace(matching_variant.id::text,'-','') end;
    if entry ? 'externalSku' and entry->>'externalSku' is distinct from provider_sku then raise exception 'external_sku_conflict'; end if;
    select external_product_id into existing_id from private.bling_product_links where variant_id=matching_variant.id;
    if existing_id is not null and existing_id<>external_id then raise exception 'sku_link_conflict'; end if;
    insert into private.bling_product_links(variant_id,external_product_id,sku,external_sku,source,local_version,sync_status,last_synced_at)
    values(matching_variant.id,external_id,matching_variant.sku::text,provider_sku,'curtiz',null,'matched',now())
    on conflict(variant_id) do update set sku=excluded.sku,external_sku=excluded.external_sku,last_synced_at=now();
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling','bling.product.sync',jsonb_build_object('variantId',matching_variant.id),'bling:product:initial:'||matching_variant.id::text)
    on conflict(idempotency_key) do nothing;
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling','bling.stock.sync',jsonb_build_object('variantId',matching_variant.id),'bling:stock:initial:'||matching_variant.id::text)
    on conflict(idempotency_key) do nothing;
    matched:=matched+1;
  end loop;
  return matched;
end;
$$;
create or replace function public.read_bling_product_links(p_variant_ids uuid[])
returns jsonb language sql security definer set search_path = '' stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('variantId',variant_id,'externalProductId',external_product_id,
    'sku',sku,'externalSku',external_sku,'status',sync_status)), '[]'::jsonb)
  from private.bling_product_links where variant_id=any(p_variant_ids);
$$;
create or replace function public.read_bling_external_mappings(p_external_ids bigint[])
returns jsonb language plpgsql security definer set search_path = '' stable as $$
begin
  if coalesce(cardinality(p_external_ids),0)>100 then raise exception 'invalid_page_size'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('variantId',variant_id,'externalProductId',external_product_id,
    'sku',sku,'externalSku',external_sku)), '[]'::jsonb) from private.bling_product_links where external_product_id=any(p_external_ids));
end;
$$;
revoke all on function public.read_bling_external_mappings(bigint[]) from public,anon,authenticated;
grant execute on function public.read_bling_external_mappings(bigint[]) to service_role;
