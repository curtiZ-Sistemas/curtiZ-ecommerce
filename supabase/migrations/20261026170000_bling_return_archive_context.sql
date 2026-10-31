-- Read-only previews use the authorized archive and the canonical return records.
-- No new document, emission, refund, stock movement or fiscal approval is created.
create function public.read_bling_return_fiscal_context(p_return_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ret public.returns%rowtype; ord public.orders%rowtype;
  link private.bling_order_links%rowtype; archive private.bling_invoice_archives%rowtype;
begin
  select * into ret from public.returns where id=p_return_id and status not in ('rejected','cancelled');
  if not found then return null; end if;
  select * into ord from public.orders where id=ret.order_id and customer_id=ret.customer_id;
  if not found then return null; end if;
  select * into link from private.bling_order_links where order_id=ord.id and invoice_status='authorized'
    and invoice_access_key ~ '^[0-9]{44}$';
  if not found then return null; end if;
  select * into archive from private.bling_invoice_archives where order_id=ord.id and invoice_id=link.invoice_id and format='xml';
  if not found then return null; end if;
  if not exists(select 1 from public.return_items where return_id=ret.id)
    or exists(select 1 from public.return_items ri join public.order_items oi on oi.id=ri.order_item_id
      join public.returns r on r.id=ri.return_id
      where (r.id=ret.id or oi.order_id=ord.id) and (oi.order_id<>r.order_id
        or r.customer_id is distinct from (select o.customer_id from public.orders o where o.id=oi.order_id))) then return null; end if;
  return jsonb_build_object('returnId',ret.id,'orderId',ord.id,'invoiceId',link.invoice_id,'invoiceKey',link.invoice_access_key,
    'archive',jsonb_build_object('storagePath',archive.storage_path,'sha256',archive.sha256),
    'totals',jsonb_build_object('totalInCents',(ord.grand_total*100)::bigint,
      'shippingInCents',(ord.shipping_total*100)::bigint,'discountInCents',(ord.discount_total*100)::bigint,'additionalInCents',(ord.fee_total*100)::bigint),
    'items',(select coalesce(jsonb_agg(jsonb_build_object('id',oi.id,'variantId',oi.variant_id,'sku',oi.sku_snapshot,
      'quantity',oi.quantity,'unitPriceInCents',(oi.unit_price*100)::bigint,
      'requestedQuantity',coalesce((select ri.quantity from public.return_items ri where ri.return_id=ret.id and ri.order_item_id=oi.id),0),
      'otherReturnsQuantity',coalesce((select sum(ri.quantity) from public.return_items ri join public.returns r on r.id=ri.return_id
        where ri.order_item_id=oi.id and ri.return_id<>ret.id and r.status not in ('rejected','cancelled')),0)) order by oi.id),'[]'::jsonb)
      from public.order_items oi where oi.order_id=ord.id));
end;
$$;
revoke all on function public.read_bling_return_fiscal_context(uuid) from public,anon,authenticated;
grant execute on function public.read_bling_return_fiscal_context(uuid) to service_role;

-- Serialize reservations on the original item, including completed returns.
-- Existing inconsistent records are preserved and rejected by the preview.
create function private.check_return_item_cumulative_balance()
returns trigger language plpgsql security definer set search_path='' as $$
declare sold public.order_items%rowtype; ret public.returns%rowtype; taken bigint;
begin
  if tg_op='UPDATE' and (new.return_id<>old.return_id or new.order_item_id<>old.order_item_id) then
    raise exception 'return_item_identity_immutable' using errcode='23514';
  end if;
  select * into sold from public.order_items where id=new.order_item_id for update;
  select * into ret from public.returns where id=new.return_id;
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
create trigger check_return_item_cumulative_balance before insert or update of return_id,order_item_id,quantity
  on public.return_items for each row execute function private.check_return_item_cumulative_balance();

create function private.check_return_reactivation_balance()
returns trigger language plpgsql security definer set search_path='' as $$
declare item record; taken bigint;
begin
  if (new.order_id<>old.order_id or new.customer_id<>old.customer_id)
    and exists(select 1 from public.return_items where return_id=new.id) then
    raise exception 'return_identity_immutable' using errcode='23514';
  end if;
  if old.status in ('rejected','cancelled') and new.status not in ('rejected','cancelled') then
    for item in select oi.id,oi.quantity,ri.quantity requested from public.order_items oi
      join public.return_items ri on ri.order_item_id=oi.id where ri.return_id=new.id order by oi.id for update of oi loop
      select coalesce(sum(ri.quantity),0) into taken from public.return_items ri join public.returns r on r.id=ri.return_id
        where ri.order_item_id=item.id and ri.return_id<>new.id and r.status not in ('rejected','cancelled');
      if taken+item.requested>item.quantity then raise exception 'return_cumulative_quantity_exceeded' using errcode='23514'; end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.check_return_reactivation_balance() from public,anon,authenticated,service_role;
create trigger check_return_reactivation_balance before update of status,order_id,customer_id
  on public.returns for each row execute function private.check_return_reactivation_balance();
notify pgrst,'reload schema';
