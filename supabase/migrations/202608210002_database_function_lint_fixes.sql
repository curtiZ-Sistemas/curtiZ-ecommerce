-- Corrige funções já existentes sem reescrever migrations aplicadas.

create or replace function private.convert_referral_attribution(p_representative_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  attribution public.referral_attributions%rowtype;
begin
  select * into attribution
  from public.referral_attributions
  where user_id = (select user_id from public.representatives where id = p_representative_id)
  for update;
  if attribution.user_id is null then return; end if;
  if attribution.sponsor_representative_id = p_representative_id then
    raise exception 'self referral is forbidden' using errcode = '23514';
  end if;
  insert into public.referral_relationships(representative_id, sponsor_id, source)
  values(p_representative_id, attribution.sponsor_representative_id, 'attribution')
  on conflict(representative_id) do nothing;
  update public.referral_attributions
  set converted_representative_id = p_representative_id, converted_at = now()
  where user_id = attribution.user_id and converted_representative_id is null;
  perform private.rebuild_representative_network_closure();
end;
$$;

create or replace function public.request_customer_return(
  p_order_item_id uuid,
  p_quantity integer,
  p_reason text,
  p_description text,
  p_resolution text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  customer_order_id uuid;
  available_quantity integer;
  new_return_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select item.order_id, item.quantity
  into customer_order_id, available_quantity
  from public.order_items item
  join public.orders customer_order on customer_order.id = item.order_id
  where item.id = p_order_item_id
    and customer_order.customer_id = auth.uid()
    and customer_order.status = 'delivered';

  if customer_order_id is null then
    raise exception 'delivered_item_not_found' using errcode = 'P0002';
  end if;

  if p_quantity < 1 or p_quantity > available_quantity then
    raise exception 'invalid_return_quantity' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.return_items existing_item
    join public.returns existing_return on existing_return.id = existing_item.return_id
    where existing_item.order_item_id = p_order_item_id
      and existing_return.customer_id = auth.uid()
      and existing_return.status not in ('rejected', 'completed', 'cancelled')
  ) then
    raise exception 'open_return_already_exists' using errcode = '23505';
  end if;

  if char_length(trim(p_reason)) not between 3 and 120
    or char_length(trim(p_description)) not between 10 and 2000
    or p_resolution not in ('exchange', 'refund', 'store_credit') then
    raise exception 'invalid_return_request' using errcode = '23514';
  end if;

  insert into public.returns(
    order_id, customer_id, reason, description, requested_resolution,
    eligibility_snapshot
  )
  values (
    customer_order_id, auth.uid(), trim(p_reason), trim(p_description), p_resolution,
    jsonb_build_object(
      'orderStatus', 'delivered',
      'requestedQuantity', p_quantity,
      'requiresManualReview', true,
      'evaluatedAt', now()
    )
  )
  returning id into new_return_id;

  insert into public.return_items(return_id, order_item_id, quantity)
  values (new_return_id, p_order_item_id, p_quantity);

  update public.orders
  set status = 'return_requested', updated_at = now()
  where id = customer_order_id and status = 'delivered';

  return new_return_id;
end;
$$;

create or replace function public.technical_database_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  last_migration text;
begin
  perform private.require_permission('technical.database.read');
  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select max(version)::text from supabase_migrations.schema_migrations'
    into last_migration;
  end if;
  select jsonb_build_object(
    'database_size_bytes', pg_database_size(current_database()),
    'active_connections', (
      select count(*) from pg_catalog.pg_stat_activity where datname = current_database()
    ),
    'public_tables', (
      select count(*) from pg_catalog.pg_tables where schemaname = 'public'
    ),
    'public_indexes', (
      select count(*) from pg_catalog.pg_indexes where schemaname = 'public'
    ),
    'last_migration', last_migration,
    'server_version', current_setting('server_version')
  ) into result;
  return result;
end;
$$;

create or replace function public.delete_help_content_draft(p_id uuid,p_confirmation text)
returns void language plpgsql security definer set search_path = '' as $$
declare content public.help_contents;
begin
  perform private.require_permission('support_content.edit');
  select * into content from public.help_contents where id=p_id for update;
  if not found or content.status<>'draft' or content.published_version_id is not null or content.current_version>0
    or p_confirmation<>'EXCLUIR' then raise exception 'only untouched drafts can be deleted'; end if;
  delete from public.help_contents where id=p_id;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,previous_data_sanitized,reason)
  values(auth.uid(),private.current_app_role(),'help_content.delete','help_content',p_id,jsonb_build_object('title',content.title),'Exclusão confirmada de rascunho sem versões');
end;
$$;

create or replace function public.sync_customer_cart(
  p_lines jsonb,
  p_source_cart_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  target_cart_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 50 then
    raise exception 'invalid_cart_payload' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) as requested(value)
    where jsonb_typeof(requested.value) is distinct from 'object'
      or jsonb_typeof(requested.value->'quantity') is distinct from 'number'
      or (requested.value->>'quantity') !~ '^[0-9]+$'
      or (requested.value->>'quantity')::integer not between 1 and 99
      or nullif(trim(requested.value->>'product_id'), '') is null
      or nullif(trim(requested.value->>'color'), '') is null
      or nullif(trim(requested.value->>'size'), '') is null
  ) then
    raise exception 'invalid_cart_line' using errcode = '22023';
  end if;

  result := public.merge_customer_cart(p_lines, p_source_cart_id);
  target_cart_id := nullif(result->>'cartId', '')::uuid;

  if target_cart_id is not null and p_source_cart_id = target_cart_id then
    with requested as (
      select
        nullif(trim(item.product_id), '') as product_id,
        nullif(trim(item.color), '') as color,
        nullif(trim(item.size), '') as size,
        item.quantity
      from jsonb_to_recordset(p_lines) as item(
        product_id text,
        color text,
        size text,
        quantity integer,
        requested_price_cents integer
      )
    ),
    resolved as (
      select
        variant.id as variant_id,
        least(
          sum(requested.quantity)::integer,
          greatest(stock.available_quantity, 0),
          99
        ) as quantity,
        coalesce(variant.price_override, product.base_price) as current_price
      from requested
      join public.products product
        on product.id::text = requested.product_id
        and product.status = 'active'
      join public.product_variants variant
        on variant.product_id = product.id
        and variant.active
        and lower(variant.color_name) = lower(requested.color)
        and lower(variant.size) = lower(requested.size)
      join public.inventory stock on stock.variant_id = variant.id
      group by
        variant.id,
        variant.price_override,
        product.base_price,
        stock.available_quantity
      having greatest(stock.available_quantity, 0) > 0
    )
    update public.cart_items item
    set quantity = resolved.quantity,
        unit_price_snapshot = resolved.current_price,
        updated_at = now()
    from resolved
    where item.cart_id = target_cart_id
      and item.variant_id = resolved.variant_id;

    delete from public.cart_items item
    where item.cart_id = target_cart_id
      and not exists (
        select 1
        from jsonb_to_recordset(p_lines) as requested(
          product_id text,
          color text,
          size text,
          quantity integer,
          requested_price_cents integer
        )
        join public.products product
          on product.id::text = nullif(trim(requested.product_id), '')
        join public.product_variants variant
          on variant.product_id = product.id
          and lower(variant.color_name) = lower(nullif(trim(requested.color), ''))
          and lower(variant.size) = lower(nullif(trim(requested.size), ''))
        where variant.id = item.variant_id
      );

    result := public.merge_customer_cart('[]'::jsonb, target_cart_id);
  end if;

  return result;
end;
$$;

create or replace function public.reorder_homepage_sections(p_section_ids uuid[],p_expected_revisions integer[])
returns void language plpgsql security definer set search_path=''
as $$
declare section_row public.homepage_sections;
begin
  perform private.require_permission('homepage.edit');
  if coalesce(array_length(p_section_ids,1),0)=0 or array_length(p_section_ids,1)<>array_length(p_expected_revisions,1) or array_length(p_section_ids,1)>40 then raise exception 'invalid homepage order'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('curtiz:homepage-order'));
  for position_index in 1..array_length(p_section_ids,1) loop
    select * into section_row from public.homepage_sections where id=p_section_ids[position_index] for update;
    if section_row.id is null or section_row.revision<>p_expected_revisions[position_index] then raise exception 'homepage revision conflict' using errcode='40001'; end if;
    update public.homepage_sections set sort_order=position_index,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=section_row.id;
  end loop;
  insert into public.home_section_audit_logs(actor_id,actor_role,action,new_data) values(auth.uid(),private.current_app_role(),'homepage.sections.reordered',jsonb_build_object('sectionIds',p_section_ids));
end $$;

revoke all on function public.sync_customer_cart(jsonb, uuid) from public, anon;
grant execute on function public.sync_customer_cart(jsonb, uuid) to authenticated;
revoke all on function public.reorder_homepage_sections(uuid[], integer[]) from public, anon;
grant execute on function public.reorder_homepage_sections(uuid[], integer[]) to authenticated;

notify pgrst, 'reload schema';
