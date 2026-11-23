-- Allow representatives to permanently clear their own sales from the portal.
-- Stock is restored only once for confirmed sales and a sanitized audit record
-- is kept before the operational sale rows are removed.
create or replace function public.delete_representative_sale(
  p_sale_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  representative_row public.representatives%rowtype;
  sale_row public.representative_sales%rowtype;
  item record;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if lower(trim(coalesce(p_confirmation, ''))) not in ('excluir', 'delete', 'apagar') then
    raise exception 'explicit delete confirmation required' using errcode = '22023';
  end if;

  select * into representative_row
  from public.representatives where user_id = auth.uid();
  if representative_row.id is null then
    raise exception 'representative not found' using errcode = '42501';
  end if;
  select * into sale_row
  from public.representative_sales
  where id = p_sale_id and representative_id = representative_row.id
  for update;
  if sale_row.id is null then
    raise exception 'sale not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.commission_entries entry
    where entry.sale_id = sale_row.id and entry.status = 'paid'
  ) then
    raise exception 'sale commission is already paid' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.commission_entries entry
    join public.commission_closing_entries closing_entry
      on closing_entry.commission_entry_id = entry.id
    where entry.sale_id = sale_row.id
  ) then
    raise exception 'sale commission is in a closing' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.commission_entries entry
    where entry.sale_id = sale_row.id and entry.reversal_of is not null
  ) then
    raise exception 'sale commission history is preserved' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.commission_entries entry
    join public.commission_entries reversal on reversal.reversal_of = entry.id
    where entry.sale_id = sale_row.id
  ) then
    raise exception 'sale commission history is preserved' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.commission_entries entry
    join public.commission_adjustments adjustment
      on adjustment.commission_entry_id = entry.id
    where entry.sale_id = sale_row.id
  ) then
    raise exception 'sale commission history is preserved' using errcode = '23514';
  end if;

  if sale_row.status = 'confirmed' then
    for item in
      select variant_id, quantity
      from public.representative_sale_items
      where sale_id = sale_row.id
      order by variant_id
    loop
      insert into public.representative_inventory(representative_id, variant_id, quantity)
      values (representative_row.id, item.variant_id, item.quantity)
      on conflict (representative_id, variant_id) do update
        set quantity = public.representative_inventory.quantity + excluded.quantity,
            version = public.representative_inventory.version + 1,
            updated_at = now();
      insert into public.representative_inventory_movements(
        representative_id, variant_id, quantity_delta, reason, source_type,
        source_id, idempotency_key, created_by
      ) values (
        representative_row.id, item.variant_id, item.quantity,
        'sale_delete', 'representative_sale', sale_row.id,
        'delete:' || sale_row.id::text || ':' || item.variant_id::text,
        auth.uid()
      );
    end loop;
  end if;

  -- Sale items cascade. Commission entries are removed only when they are not
  -- part of a closing, preserving closing and adjustment history otherwise.
  delete from public.commission_entries where sale_id = sale_row.id;

  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id,
    previous_data_sanitized, reason
  ) values (
    auth.uid(), private.current_app_role(), 'representative.sale.deleted',
    'representative_sale', sale_row.id,
    jsonb_build_object(
      'public_code', sale_row.public_code,
      'status', sale_row.status,
      'total_in_cents', sale_row.total_in_cents
    ),
    'Deleted by the representative from the portal'
  );

  delete from public.representative_sales where id = sale_row.id;

  return jsonb_build_object('deleted', true, 'public_code', sale_row.public_code);
end;
$$;

revoke all on function public.delete_representative_sale(uuid, text) from public, anon;
grant execute on function public.delete_representative_sale(uuid, text) to authenticated;
