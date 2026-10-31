-- Parent-first locking also serializes membership/quantity changes against
-- reactivation. The preceding migration was already validated in the isolate.
create or replace function private.check_return_item_cumulative_balance()
returns trigger language plpgsql security definer set search_path='' as $$
declare sold public.order_items%rowtype; ret public.returns%rowtype; taken bigint;
begin
  if tg_op='UPDATE' and (new.return_id<>old.return_id or new.order_item_id<>old.order_item_id) then
    raise exception 'return_item_identity_immutable' using errcode='23514';
  end if;
  select * into ret from public.returns where id=new.return_id for update;
  select * into sold from public.order_items where id=new.order_item_id for update;
  if sold.id is null or ret.id is null or sold.order_id<>ret.order_id
    or ret.customer_id is distinct from (select customer_id from public.orders where id=sold.order_id) then
    raise exception 'return_original_item_mismatch' using errcode='23514';
  end if;
  if new.quantity>sold.quantity then raise exception 'return_cumulative_quantity_exceeded' using errcode='23514'; end if;
  if ret.status not in ('rejected','cancelled') then
    select coalesce(sum(ri.quantity),0) into taken from public.return_items ri join public.returns r on r.id=ri.return_id
      where ri.order_item_id=sold.id and ri.id<>new.id and r.status not in ('rejected','cancelled');
    if taken+new.quantity>sold.quantity then raise exception 'return_cumulative_quantity_exceeded' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.check_return_item_cumulative_balance() from public,anon,authenticated,service_role;

create or replace function private.check_return_reactivation_balance()
returns trigger language plpgsql security definer set search_path='' as $$
declare item record; taken bigint; requested bigint;
begin
  if (new.order_id<>old.order_id or new.customer_id<>old.customer_id)
    and exists(select 1 from public.return_items where return_id=new.id) then
    raise exception 'return_identity_immutable' using errcode='23514';
  end if;
  if old.status in ('rejected','cancelled') and new.status not in ('rejected','cancelled') then
    for item in select oi.id,oi.quantity from public.order_items oi
      join public.return_items ri on ri.order_item_id=oi.id where ri.return_id=new.id order by oi.id for update of oi loop
      -- Read quantities after acquiring the original item's lock, never from
      -- a join snapshot taken before waiting for another transaction.
      select coalesce(sum(ri.quantity),0) into requested from public.return_items ri
        where ri.order_item_id=item.id and ri.return_id=new.id;
      select coalesce(sum(ri.quantity),0) into taken from public.return_items ri join public.returns r on r.id=ri.return_id
        where ri.order_item_id=item.id and ri.return_id<>new.id and r.status not in ('rejected','cancelled');
      if taken+requested>item.quantity then raise exception 'return_cumulative_quantity_exceeded' using errcode='23514'; end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.check_return_reactivation_balance() from public,anon,authenticated,service_role;
