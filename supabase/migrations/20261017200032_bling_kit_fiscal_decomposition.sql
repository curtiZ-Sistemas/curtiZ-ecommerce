-- Fiscal composition is independent of stock/BOM. No commercial data is seeded.
alter table private.bling_fiscal_rules
  add column pis_cst text check(pis_cst ~ '^[0-9]{2}$'),
  add column cofins_cst text check(cofins_cst ~ '^[0-9]{2}$'),
  add column ipi_cst text check(ipi_cst ~ '^[0-9]{2}$');
create table private.bling_kit_fiscal_components (
  kit_variant_id uuid not null references public.product_variants(id),
  position integer not null check(position between 1 and 100),
  sku text not null unique check(length(sku) between 1 and 60),
  description text not null check(length(description) between 3 and 250),
  unit text not null default 'PR' check(unit='PR'),
  quantity_pairs integer not null check(quantity_pairs between 1 and 100),
  allocation_weight integer not null check(allocation_weight between 1 and 1000000),
  ncm text not null check(ncm ~ '^[0-9]{8}$'),
  origin integer not null check(origin between 0 and 8),
  cest text not null check(cest='' or cest ~ '^[0-9]{7}$'),
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  evidence_reference text not null check(length(evidence_reference) between 10 and 200),
  primary key(kit_variant_id,position)
);
alter table private.bling_kit_fiscal_components enable row level security;
alter table private.bling_kit_fiscal_components force row level security;
revoke all on private.bling_kit_fiscal_components from public,anon,authenticated;

create function private.bling_kit_source_hash(p_variant_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_array(
    v.id,v.sku,v.color_name,v.size,p.name,m.pairs_per_sku,m.ncm,m.origin,m.cest)::text,'UTF8')),'hex')
  from public.product_variants v join public.products p on p.id=v.product_id
  join private.bling_catalog_metadata m on m.product_id=p.id where v.id=p_variant_id;
$$;
revoke all on function private.bling_kit_source_hash(uuid) from public,anon,authenticated;

alter function public.read_bling_catalog_variant(uuid) rename to read_bling_catalog_variant_base;
revoke all on function public.read_bling_catalog_variant_base(uuid) from public,anon,authenticated,service_role;
create function public.read_bling_catalog_variant(p_variant_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select public.read_bling_catalog_variant_base(p_variant_id) || jsonb_build_object('kit_components',(
    select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('source_current',c.source_hash=private.bling_kit_source_hash(p_variant_id))
      order by c.position),'[]'::jsonb) from private.bling_kit_fiscal_components c where c.kit_variant_id=p_variant_id));
$$;
revoke all on function public.read_bling_catalog_variant(uuid) from public,anon,authenticated;
grant execute on function public.read_bling_catalog_variant(uuid) to service_role;

create or replace function private.bling_fiscal_configuration_hash()
returns text language sql stable security definer set search_path='' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object(
    'rules',public.read_bling_fiscal_rules(),
    'metadata',(select coalesce(jsonb_agg(to_jsonb(m)order by m.product_id),'[]'::jsonb)from private.bling_catalog_metadata m),
    'components',(select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('currentSource',private.bling_kit_source_hash(c.kit_variant_id))
      order by c.kit_variant_id,c.position),'[]'::jsonb)from private.bling_kit_fiscal_components c)
  )::text,'UTF8')),'hex');
$$;

-- The previous approval implementation locks rule tables; include composition edits
-- under the same transaction before delegating. No broader caller privilege.
alter function public.save_bling_automatic_mirror_approval(uuid,text,text,boolean,boolean) rename to save_bling_automatic_mirror_approval_base;
revoke all on function public.save_bling_automatic_mirror_approval_base(uuid,text,text,boolean,boolean) from public,anon,authenticated,service_role;
create function public.save_bling_automatic_mirror_approval(p_order_id uuid,p_mirror_hash text,p_configuration_hash text,p_icms_taxpayer boolean,p_final_consumer boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  lock table private.bling_kit_fiscal_components in share mode;
  return public.save_bling_automatic_mirror_approval_base(p_order_id,p_mirror_hash,p_configuration_hash,p_icms_taxpayer,p_final_consumer);
end;
$$;
revoke all on function public.save_bling_automatic_mirror_approval(uuid,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.save_bling_automatic_mirror_approval(uuid,text,text,boolean,boolean) to service_role;

-- Preparation retries operate on the same draft; uncertain writes must be reconciled first.
create or replace function public.request_bling_invoice_action(p_order_id uuid,p_action text)
returns boolean language plpgsql security definer set search_path='' as $$
declare link private.bling_order_links%rowtype; kind text; key text;
begin
  if not(private.has_permission('operations.tasks.execute')or private.has_permission('technical.integrations.manage')
    or private.has_permission('orders.update_operational_status'))then raise exception 'permission_denied' using errcode='42501';end if;
  if p_action is null or p_action not in('prepare','send','consult')then return false;end if;
  perform 1 from public.orders where id=p_order_id for update;
  select * into link from private.bling_order_links where order_id=p_order_id for update;
  if not found or link.external_order_id is null then return false;end if;
  if p_action<>'consult'and(not public.assert_bling_order_writable(p_order_id)or link.erp_status<>'synced'
    or link.invoice_status in('authorized','cancelled')or link.last_error_code in('uncertain_write','lease_expired_reconciliation_required'))then return false;end if;
  if p_action='prepare'then
    if link.invoice_id is not null and link.invoice_status not in('pending','awaiting_data','error')then return false;end if;
    kind:='bling.invoice.generate';key:='bling:generate-invoice:'||p_order_id::text;
  elsif p_action='send'then
    if link.invoice_id is null or link.invoice_status<>'pending'then return false;end if;
    kind:='bling.invoice.send';key:='bling:send-invoice:'||p_order_id::text;
  else
    if link.invoice_id is null then return false;end if;
    kind:='bling.invoice.poll';key:='bling:poll-invoice:'||p_order_id::text||':'||link.invoice_id::text;
  end if;
  insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling',kind,jsonb_build_object('orderId',p_order_id),key)
    on conflict(idempotency_key)do update set status='pending',available_at=now(),attempts=0,error_summary=null,completed_at=null,locked_at=null,lock_id=null
    where public.background_jobs.status in('completed','failed')
      and coalesce(public.background_jobs.error_summary,'')not in('uncertain_write','lease_expired_reconciliation_required');
  if not found then return false;end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'integration.bling.invoice_'||p_action,'order',p_order_id,'{}');
  return true;
end;
$$;
