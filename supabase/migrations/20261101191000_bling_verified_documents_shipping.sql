-- Incremental: existing documents remain untouched and unverified until read.
alter table private.bling_invoice_archives
  add column verified_environment smallint check(verified_environment in(1,2)),
  add column verified_access_key text check(verified_access_key ~ '^[0-9]{44}$');

create function public.read_bling_invoice_archive_context(p_order_id uuid,p_invoice_id bigint)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('invoiceKey',l.invoice_access_key,'invoiceNumber',l.invoice_number,
    'series',r.series,'issuerDocument',regexp_replace(c.tax_id,'[^0-9]','','g'),
    'totalInCents',round(o.grand_total*100)::bigint)
  from private.bling_order_links l join public.orders o on o.id=l.order_id
  cross join private.bling_fiscal_rules r cross join public.company_legal_information c
  where l.order_id=p_order_id and l.invoice_id=p_invoice_id and l.invoice_status='authorized'
    and r.scenario='sale_in_state';
$$;
revoke all on function public.read_bling_invoice_archive_context(uuid,bigint) from public,anon,authenticated;
grant execute on function public.read_bling_invoice_archive_context(uuid,bigint) to service_role;

create function private.bling_invoice_documents_ready(p_order_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.bling_order_links l
    join private.bling_invoice_archives x on x.order_id=l.order_id and x.invoice_id=l.invoice_id and x.format='xml'
    join private.bling_invoice_archives p on p.order_id=l.order_id and p.invoice_id=l.invoice_id and p.format='pdf'
    where l.order_id=p_order_id and l.invoice_status='authorized' and l.erp_status='synced'
      and l.invoice_access_key ~ '^[0-9]{44}$' and x.verified_environment=1
      and x.verified_access_key=l.invoice_access_key);
$$;
revoke all on function private.bling_invoice_documents_ready(uuid) from public,anon,authenticated,service_role;

create function public.verify_bling_invoice_archive(p_order_id uuid,p_invoice_id bigint,p_access_key text,
  p_xml_sha256 text,p_environment integer)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_environment is null or p_environment not in(1,2) or p_access_key is null or p_access_key !~ '^[0-9]{44}$'
    or p_xml_sha256 is null or p_xml_sha256 !~ '^[a-f0-9]{64}$' then return false; end if;
  perform 1 from public.orders where id=p_order_id for update;
  perform 1 from private.bling_order_links where order_id=p_order_id and invoice_id=p_invoice_id
    and invoice_status='authorized' and invoice_access_key=p_access_key for update;
  if not found or not exists(select 1 from private.bling_invoice_archives
    where order_id=p_order_id and invoice_id=p_invoice_id and format='pdf') then return false; end if;
  update private.bling_invoice_archives set verified_environment=p_environment,verified_access_key=p_access_key
  where order_id=p_order_id and invoice_id=p_invoice_id and format='xml' and sha256=p_xml_sha256
    and (verified_environment is null or verified_environment=p_environment)
    and (verified_access_key is null or verified_access_key=p_access_key);
  if not found then return false; end if;
  if private.bling_invoice_documents_ready(p_order_id) then
    update public.shipments set operation_state='pending',last_error_code=null,updated_at=now()
      where order_id=p_order_id and operation_state='awaiting_invoice';
    update public.background_jobs j set status='pending',attempts=0,error_summary=null,available_at=now(),completed_at=null
      where j.queue='shipping' and j.status='failed' and j.error_summary='fiscal_shipping_blocked'
        and exists(select 1 from public.shipments s where s.id::text=j.payload_sanitized->>'shipmentId'
          and s.order_id=p_order_id and s.operation_state='pending');
  end if;
  return true;
end;
$$;
revoke all on function public.verify_bling_invoice_archive(uuid,bigint,text,text,integer) from public,anon,authenticated;
grant execute on function public.verify_bling_invoice_archive(uuid,bigint,text,text,integer) to service_role;

create or replace function public.read_bling_shipping_clearance(p_order_id uuid)
returns jsonb language sql security definer set search_path='' stable as $$
  select jsonb_build_object('required',policy.invoice_required,
    'allowed',not policy.invoice_required or private.bling_invoice_documents_ready(p_order_id),
    'accessKey',case when policy.invoice_required and private.bling_invoice_documents_ready(p_order_id)
      then link.invoice_access_key else null end)
  from private.bling_shipping_policy policy left join private.bling_order_links link on link.order_id=p_order_id
  where policy.singleton;
$$;

create or replace function private.guard_bling_shipment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.operation_state is distinct from old.operation_state and new.operation_state in('creating','purchasing','generating','generated'))
    or (new.status is distinct from old.status and new.status='dispatched') then
    if (select invoice_required from private.bling_shipping_policy where singleton) and
      (not private.bling_invoice_documents_ready(new.order_id) or not exists(select 1 from public.orders o
        where o.id=new.order_id and o.payment_status='approved'
          and o.status not in('cancelled','refunded','manual_review','cancellation_requested','refund_pending'))) then
      raise exception 'fiscal_shipping_blocked' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.guard_bling_order_dispatch()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status is distinct from old.status and (new.status='shipped' or new.status='delivered' and old.status<>'shipped')
    and (select invoice_required from private.bling_shipping_policy where singleton) then
    if not private.bling_invoice_documents_ready(new.id) or new.payment_status<>'approved'
      then raise exception 'fiscal_shipping_blocked' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;

-- Never rewrite prior archives or infer production from APP_ENV/OAuth. tpAmb is
-- obtained by the server from the matching authorized XML, not from a browser.

-- Authorization queues archiving; only verified production archives release shipping.
create or replace function public.observe_bling_invoice_base(p_invoice_id bigint,p_order_code text,p_situation integer,
  p_invoice_number text,p_access_key text,p_observed_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare mapped_status text; linked_order_id uuid; item record;
begin
  mapped_status := case p_situation when 1 then 'pending' when 2 then 'cancelled'
    when 3 then 'processing' when 4 then 'rejected' when 5 then 'authorized'
    when 6 then 'authorized' when 7 then 'processing' when 8 then 'processing'
    when 9 then 'rejected' when 10 then 'processing' when 11 then 'rejected' else 'error' end;
  update private.bling_order_links link set invoice_id=p_invoice_id,invoice_status=mapped_status,
    invoice_number=case when mapped_status='authorized' then nullif(p_invoice_number,'') else link.invoice_number end,
    invoice_access_key=case when mapped_status='authorized' then nullif(p_access_key,'') else link.invoice_access_key end,
    last_error_code=case when mapped_status='rejected' then 'fiscal_rejected_' || p_situation::text
      when mapped_status='cancelled' then 'fiscal_cancelled'
      when mapped_status='authorized' and link.last_error_code in('validation_error','invoice_processing','fiscal_not_ready','fiscal_automation_policy_required') then null
      else link.last_error_code end,
    external_observed_at=p_observed_at,updated_at=now()
  from public.orders o where o.id=link.order_id and o.public_code=p_order_code
    and link.external_order_id is not null
    and (link.invoice_id is null or link.invoice_id=p_invoice_id)
    and (link.external_observed_at is null or link.external_observed_at<=p_observed_at)
  returning link.order_id into linked_order_id;
  if linked_order_id is null then
    -- A later observation already won: acknowledge this event without overwriting it.
    return exists(select 1 from private.bling_order_links link join public.orders o on o.id=link.order_id
      where link.invoice_id=p_invoice_id and o.public_code=p_order_code and link.external_observed_at>p_observed_at);
  end if;
  if mapped_status='authorized' then
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling','bling.invoice.email',jsonb_build_object('orderId',linked_order_id),
      'bling:invoice-email:' || linked_order_id::text || ':' || p_invoice_id::text)
    on conflict(idempotency_key) do nothing;
    for item in select distinct variant_id from public.order_items where order_id=linked_order_id loop
      insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
      values('bling','bling.stock.sync',jsonb_build_object('variantId',item.variant_id),
        'bling:stock:invoice:' || p_invoice_id::text || ':' || item.variant_id::text)
      on conflict(idempotency_key) do nothing;
    end loop;
  end if;
  return true;
end;
$$;
