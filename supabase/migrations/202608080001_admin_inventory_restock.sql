-- Reposição administrativa atômica, autorizada e auditável.

insert into public.permissions(code, description)
values ('inventory.adjust', 'Ajustar estoque com justificativa e auditoria')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions(role, permission_id)
select 'admin', id
from public.permissions
where code = 'inventory.adjust'
on conflict do nothing;

create or replace function public.admin_restock_inventory(
  p_product_id uuid,
  p_variant_id uuid,
  p_quantity integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_inventory public.inventory%rowtype;
  next_quantity integer;
begin
  perform private.require_permission('inventory.adjust');

  if p_quantity is null or p_quantity < 1 or p_quantity > 99999 then
    raise exception 'invalid restock quantity';
  end if;

  if char_length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'a reason with at least ten characters is required';
  end if;

  select inventory.*
  into current_inventory
  from public.inventory inventory
  where inventory.variant_id = p_variant_id
    and exists (
      select 1
      from public.product_variants variant
      where variant.id = p_variant_id
        and variant.product_id = p_product_id
    )
  for update;

  if current_inventory.variant_id is null then
    raise exception 'inventory record not found';
  end if;

  next_quantity := current_inventory.available_quantity + p_quantity;

  update public.inventory
  set available_quantity = next_quantity,
      version = current_inventory.version + 1,
      updated_at = now()
  where variant_id = p_variant_id;

  insert into public.inventory_movements(
    variant_id,
    movement_type,
    quantity,
    previous_quantity,
    new_quantity,
    reason,
    reference_type,
    reference_id,
    performed_by
  ) values (
    p_variant_id,
    'admin_restock',
    p_quantity,
    current_inventory.available_quantity,
    next_quantity,
    trim(p_reason),
    'product',
    p_product_id,
    auth.uid()
  );

  insert into public.audit_logs(
    actor_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    previous_data_sanitized,
    new_data_sanitized,
    reason
  ) values (
    auth.uid(),
    private.current_app_role(),
    'admin_restock',
    'inventory',
    p_variant_id,
    jsonb_build_object('available_quantity', current_inventory.available_quantity),
    jsonb_build_object('available_quantity', next_quantity, 'quantity_added', p_quantity),
    trim(p_reason)
  );

  return next_quantity;
end;
$$;

revoke all on function public.admin_restock_inventory(uuid, uuid, integer, text)
  from public, anon;
grant execute on function public.admin_restock_inventory(uuid, uuid, integer, text)
  to authenticated;

create or replace function public.admin_approved_sales_total_in_cents()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  total_in_cents bigint;
begin
  perform private.require_permission('orders.read_all');

  select coalesce(sum(round(grand_total * 100)), 0)::bigint
  into total_in_cents
  from public.orders
  where payment_status = 'approved';

  return total_in_cents;
end;
$$;

revoke all on function public.admin_approved_sales_total_in_cents()
  from public, anon;
grant execute on function public.admin_approved_sales_total_in_cents()
  to authenticated;
