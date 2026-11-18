alter table private.representative_kit_checkout_approvals add column buyer_fiscal_address jsonb
  check (buyer_fiscal_address is null or (jsonb_typeof(buyer_fiscal_address) = 'object' and buyer_fiscal_address ->> 'state' = 'MG'
    and buyer_fiscal_address ->> 'postal_code' ~ '^3[0-9]{7}$'
    and length(btrim(coalesce(buyer_fiscal_address ->> 'street',''))) > 0
    and length(btrim(coalesce(buyer_fiscal_address ->> 'number',''))) > 0
    and length(btrim(coalesce(buyer_fiscal_address ->> 'district',''))) > 0
    and length(btrim(coalesce(buyer_fiscal_address ->> 'city',''))) > 0));

alter table private.representative_kit_orders add column buyer_snapshot jsonb
  check (jsonb_typeof(buyer_snapshot)='object');

create function private.require_representative_kit_fiscal_address()
returns trigger language plpgsql set search_path = '' as $$
declare snapshot jsonb;
begin
  if tg_op='UPDATE' and old.payment_started_at is not null then return new; end if;
  select jsonb_build_object('name',a.buyer_legal_name,'document',a.buyer_document,'registration',a.buyer_state_registration,
    'address',a.buyer_fiscal_address) into snapshot
  from private.representative_kit_checkout_approvals a where a.actor_id=new.actor_id and a.rule_version_id=new.rule_version_id
    and a.buyer_fiscal_address ->> 'state' = 'MG' and a.buyer_fiscal_address ->> 'postal_code' ~ '^3[0-9]{7}$'
    for share of a;
  if snapshot is null then raise exception 'kit_fiscal_address_required' using errcode='23514'; end if;
  if tg_op='INSERT' then new.buyer_snapshot := snapshot;
  elsif new.buyer_snapshot is distinct from snapshot then raise exception 'kit_fiscal_recipient_changed' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.require_representative_kit_fiscal_address() from public,anon,authenticated,service_role;
create trigger representative_kit_fiscal_address before insert or update of payment_started_at on private.representative_kit_orders
  for each row execute function private.require_representative_kit_fiscal_address();

create or replace function private.representative_kit_payment_allowed(o private.representative_kit_orders)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(private.find_representative_kit_checkout_approval(o.actor_id,o.variant_id,
    o.shipping_snapshot ->> 'originPostalCode')=o.rule_version_id,false)
  and exists (
    select 1 from public.profiles p join public.representatives r on r.user_id=p.id
    join public.addresses a on a.user_id=p.id
    join private.representative_kit_checkout_approvals buyer on buyer.actor_id=p.id and buyer.rule_version_id=o.rule_version_id
    where p.id=o.actor_id and p.status='active' and r.status in ('approved_waiting_kit','active','unqualified')
      and a.id=o.address_id and a.state='MG' and a.country='BR'
      and a.updated_at=(o.shipping_snapshot -> 'address' ->> 'version')::timestamptz
      and regexp_replace(a.postal_code,'[^0-9]','','g')=o.shipping_snapshot -> 'address' ->> 'postalCode'
      and o.buyer_snapshot=jsonb_build_object('name',buyer.buyer_legal_name,'document',buyer.buyer_document,
        'registration',buyer.buyer_state_registration,'address',buyer.buyer_fiscal_address)
  );
$$;

create or replace function public.representative_kit_purchase_available(p_actor uuid,p_variant uuid,p_origin text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.representative_kit_checkout_approvals a where a.actor_id=p_actor
    and a.rule_version_id=private.find_representative_kit_checkout_approval(p_actor,p_variant,p_origin)
    and a.buyer_fiscal_address ->> 'state' = 'MG' and a.buyer_fiscal_address ->> 'postal_code' ~ '^3[0-9]{7}$'
    and private.representative_kit_commercial_configuration(p_actor,a.rule_version_id));
$$;

alter table private.representative_kit_fulfillment add column invoice_draft_hash text check (invoice_draft_hash ~ '^[0-9a-f]{64}$'),
  add column reviewed_draft_hash text check (reviewed_draft_hash ~ '^[0-9a-f]{64}$'),
  add column reviewed_draft_evidence text check (length(btrim(reviewed_draft_evidence)) >= 10),
  add constraint representative_kit_review_complete check ((reviewed_draft_hash is null) = (reviewed_draft_evidence is null));

create function public.read_representative_kit_bling_order(p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('saleId',f.bling_sale_id,'invoiceId',f.bling_invoice_id,
    'buyerName',o.buyer_snapshot -> 'name','buyerDocument',o.buyer_snapshot -> 'document',
    'buyerRegistration',o.buyer_snapshot -> 'registration','fiscalAddress',o.buyer_snapshot -> 'address',
    'reviewedDraftHash',f.reviewed_draft_hash,'draftHash',f.invoice_draft_hash,
    'address',jsonb_build_object('street',d.street,'number',d.number,'district',d.district,'city',d.city,
      'complement',d.complement,'state',d.state,'postal_code',o.shipping_snapshot -> 'address' ->> 'postalCode'))
  from private.representative_kit_orders o
  join private.representative_kit_fulfillment f on f.order_id=o.id
  join public.addresses d on d.id=o.address_id and d.user_id=o.actor_id
  where o.id=p_order and o.state='paid' and o.stock_state='sold'
    and o.cancellation_requested_at is null and private.representative_kit_payment_allowed(o)
    and private.representative_kit_commercial_configuration(o.actor_id,o.rule_version_id)
    and not exists(select 1 from private.representative_kit_refund_requests r where r.order_id=o.id);
$$;

create function public.claim_representative_kit_bling_write(p_order uuid,p_operation text,p_expected_hash text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  f private.representative_kit_fulfillment;
begin
  perform 1 from private.representative_kit_orders where id=p_order for update;
  if not found then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found or public.read_representative_kit_bling_order(p_order) is null or p_operation is null then return false; end if;
  if not (case p_operation
    when 'bling_sale' then f.bling_sale_id is null
    when 'bling_invoice_draft' then f.bling_sale_id is not null and f.bling_invoice_id is null
    when 'bling_invoice_send' then f.bling_invoice_id is not null and f.invoice_access_key is null and p_expected_hash is not null
      and f.invoice_draft_hash is not distinct from p_expected_hash and f.reviewed_draft_hash is not distinct from p_expected_hash
    else false end) then return false; end if;
  insert into private.representative_kit_fulfillment_writes(order_id,operation) values(p_order,p_operation) on conflict do nothing;
  return found;
end;
$$;

create function public.link_representative_kit_bling_sale(p_order uuid,p_sale bigint,p_invoice bigint default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_sale is null or p_sale <= 0 or p_invoice <= 0 then return false; end if;
  update private.representative_kit_fulfillment f
    set bling_sale_id=p_sale,bling_invoice_id=coalesce(p_invoice,bling_invoice_id)
    where f.order_id=p_order and (f.bling_sale_id is null or f.bling_sale_id=p_sale)
      and (p_invoice is null or f.bling_invoice_id is null or f.bling_invoice_id=p_invoice)
      and not exists (select 1 from private.bling_order_links b
        where b.external_order_id=p_sale or (p_invoice is not null and b.invoice_id=p_invoice));
  return found;
end;
$$;

create function public.record_representative_kit_bling_draft(p_order uuid,p_invoice bigint,p_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  update private.representative_kit_fulfillment set invoice_draft_hash=p_hash
    where order_id=p_order and bling_invoice_id=p_invoice and invoice_access_key is null
      and public.read_representative_kit_bling_order(p_order) is not null;
  return found;
end;
$$;

revoke all on function public.read_representative_kit_bling_order(uuid),
  public.claim_representative_kit_bling_write(uuid,text,text), public.link_representative_kit_bling_sale(uuid,bigint,bigint),
  public.record_representative_kit_bling_draft(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.read_representative_kit_bling_order(uuid),
  public.claim_representative_kit_bling_write(uuid,text,text), public.link_representative_kit_bling_sale(uuid,bigint,bigint),
  public.record_representative_kit_bling_draft(uuid,bigint,text) to service_role;
