-- No business data or fiscal authorizations are seeded by this migration.
create table private.bling_order_fiscal_recipients (
  order_id uuid primary key references public.orders(id),
  icms_taxpayer boolean not null,
  final_consumer boolean not null,
  declared_by uuid not null references public.profiles(id),
  declared_at timestamptz not null default now()
);
create table private.bling_fiscal_automation_policy (
  singleton boolean primary key default true check (singleton),
  approved_configuration_hash text not null check (approved_configuration_hash ~ '^[a-f0-9]{64}$'),
  evidence_reference text not null check (length(evidence_reference) between 10 and 200),
  approved_at timestamptz not null default now()
);
alter table private.bling_order_fiscal_recipients enable row level security;
alter table private.bling_order_fiscal_recipients force row level security;
alter table private.bling_fiscal_automation_policy enable row level security;
alter table private.bling_fiscal_automation_policy force row level security;
revoke all on private.bling_order_fiscal_recipients,private.bling_fiscal_automation_policy from public,anon,authenticated;

create function private.bling_fiscal_configuration_hash()
returns text language sql stable security definer set search_path='' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object(
    'rules',public.read_bling_fiscal_rules(),
    'metadata',(select coalesce(jsonb_agg(to_jsonb(m) order by m.product_id),'[]'::jsonb) from private.bling_catalog_metadata m)
  )::text,'UTF8')),'hex');
$$;
revoke all on function private.bling_fiscal_configuration_hash() from public,anon,authenticated;

create function public.set_bling_checkout_recipient(p_order_id uuid,p_user_id uuid,p_icms_taxpayer boolean,p_final_consumer boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare sale public.orders%rowtype; existing private.bling_order_fiscal_recipients%rowtype;
begin
  if p_icms_taxpayer is null or p_final_consumer is null then return false; end if;
  select * into sale from public.orders where id=p_order_id and customer_id=p_user_id for update;
  if not found then return false; end if;
  select * into existing from private.bling_order_fiscal_recipients where order_id=p_order_id;
  if found then return existing.icms_taxpayer=p_icms_taxpayer and existing.final_consumer=p_final_consumer; end if;
  if sale.payment_status<>'pending' or sale.status<>'pending_payment' then return false; end if;
  insert into private.bling_order_fiscal_recipients(order_id,icms_taxpayer,final_consumer,declared_by)
    values(p_order_id,p_icms_taxpayer,p_final_consumer,p_user_id);
  return true;
end;
$$;

create function public.read_bling_fiscal_automation_context(p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('recipient',(select to_jsonb(r) from private.bling_order_fiscal_recipients r where r.order_id=p_order_id),
    'configurationHash',private.bling_fiscal_configuration_hash(),
    'policyApproved',exists(select 1 from private.bling_fiscal_automation_policy p
      where p.approved_configuration_hash=private.bling_fiscal_configuration_hash()));
$$;

create function public.save_bling_automatic_mirror_approval(p_order_id uuid,p_mirror_hash text,p_configuration_hash text,
  p_icms_taxpayer boolean,p_final_consumer boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare configuration text;
begin
  perform 1 from public.orders where id=p_order_id for update;
  if not public.assert_bling_order_writable(p_order_id) or p_mirror_hash is null or p_configuration_hash is null
    or p_mirror_hash !~ '^[a-f0-9]{64}$' or p_configuration_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  -- Prevent a rule/catalogue edit between the mirror read and this write.
  lock table private.bling_fiscal_rules,private.bling_fiscal_natures,private.bling_catalog_metadata in share mode;
  configuration:=private.bling_fiscal_configuration_hash();
  if configuration<>p_configuration_hash or not exists(select 1 from private.bling_fiscal_automation_policy
    where approved_configuration_hash=configuration) or not exists(select 1 from private.bling_order_fiscal_recipients r
      where r.order_id=p_order_id and r.icms_taxpayer=p_icms_taxpayer and r.final_consumer=p_final_consumer) then return false; end if;
  insert into private.bling_fiscal_mirror_approvals(order_id,mirror_hash,icms_taxpayer,final_consumer,evidence_reference)
    select p_order_id,p_mirror_hash,p_icms_taxpayer,p_final_consumer,'Automatic mirror under approved policy: '||configuration
    on conflict(order_id) do nothing;
  -- Never silently replace a previously approved, different snapshot.
  return exists(select 1 from private.bling_fiscal_mirror_approvals a where a.order_id=p_order_id
    and a.mirror_hash=p_mirror_hash and a.icms_taxpayer=p_icms_taxpayer and a.final_consumer=p_final_consumer);
end;
$$;

-- Authorized panel actions enqueue the same jobs used by automatic processing.
create function public.request_bling_invoice_action(p_order_id uuid,p_action text)
returns boolean language plpgsql security definer set search_path='' as $$
declare link private.bling_order_links%rowtype; kind text; key text;
begin
  if not (private.has_permission('operations.tasks.execute') or private.has_permission('technical.integrations.manage')
    or private.has_permission('orders.update_operational_status')) then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_action is null or p_action not in ('prepare','send','consult') then return false; end if;
  perform 1 from public.orders where id=p_order_id for update;
  select * into link from private.bling_order_links where order_id=p_order_id for update;
  if not found or link.external_order_id is null then return false; end if;
  if p_action<>'consult' and (not public.assert_bling_order_writable(p_order_id) or link.erp_status<>'synced'
    or link.invoice_status in ('authorized','cancelled') or link.last_error_code in
    ('uncertain_write','lease_expired_reconciliation_required')) then return false; end if;
  if p_action='prepare' then
    if link.invoice_id is not null then return false; end if;
    kind:='bling.invoice.generate';key:='bling:generate-invoice:'||p_order_id::text;
  elsif p_action='send' then
    if link.invoice_id is null or link.invoice_status<>'pending' then return false; end if;
    kind:='bling.invoice.send';key:='bling:send-invoice:'||p_order_id::text;
  else
    if link.invoice_id is null then return false; end if;
    kind:='bling.invoice.poll';key:='bling:poll-invoice:'||p_order_id::text||':'||link.invoice_id::text;
  end if;
  insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling',kind,jsonb_build_object('orderId',p_order_id),key)
    on conflict(idempotency_key) do update set status='pending',available_at=now(),attempts=0,
      error_summary=null,completed_at=null,locked_at=null,lock_id=null
    where public.background_jobs.status in ('completed','failed')
      and coalesce(public.background_jobs.error_summary,'') not in ('uncertain_write','lease_expired_reconciliation_required');
  if not found then return false; end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'integration.bling.invoice_'||p_action,'order',p_order_id,'{}');
  return true;
end;
$$;

-- Polls are read-only, and recover processing notes even when a webhook is lost.
create function public.enqueue_bling_invoice_poll(p_order_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare link private.bling_order_links%rowtype;
begin
  select * into link from private.bling_order_links where order_id=p_order_id;
  if not found or link.invoice_id is null or link.invoice_status not in ('pending','processing') then return false; end if;
  insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key,available_at)
    values('bling','bling.invoice.poll',jsonb_build_object('orderId',p_order_id),
      'bling:poll-invoice:'||p_order_id::text||':'||link.invoice_id::text,now()+interval '2 minutes')
    on conflict(idempotency_key) do nothing;
  return found;
end;
$$;

create table private.bling_invoice_archives (
  order_id uuid not null references public.orders(id), invoice_id bigint not null check(invoice_id>0),
  format text not null check(format in ('pdf','xml')), storage_path text not null unique,
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), archived_at timestamptz not null default now(),
  primary key(order_id,invoice_id,format)
);
alter table private.bling_invoice_archives enable row level security;
alter table private.bling_invoice_archives force row level security;
revoke all on private.bling_invoice_archives from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('fiscal-documents','fiscal-documents',false,10000000,array['application/pdf','application/xml']) on conflict(id) do nothing;

create function public.read_bling_invoice_archives(p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.format),'[]'::jsonb) from private.bling_invoice_archives a where a.order_id=p_order_id;
$$;
create function public.save_bling_invoice_archive(p_order_id uuid,p_invoice_id bigint,p_format text,p_path text,p_sha256 text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_format is null or p_sha256 is null or p_path is null or p_invoice_id is null or p_order_id is null
    or p_format not in ('pdf','xml') or p_sha256 !~ '^[a-f0-9]{64}$'
    or p_path<>p_order_id::text||'/'||p_invoice_id::text||'/'||p_sha256||'.'||p_format
    or not exists(select 1 from private.bling_order_links where order_id=p_order_id and invoice_id=p_invoice_id
      and invoice_status='authorized' and invoice_access_key ~ '^[0-9]{44}$') then return false; end if;
  insert into private.bling_invoice_archives(order_id,invoice_id,format,storage_path,sha256)
    values(p_order_id,p_invoice_id,p_format,p_path,p_sha256) on conflict(order_id,invoice_id,format) do nothing;
  return exists(select 1 from private.bling_invoice_archives where order_id=p_order_id and invoice_id=p_invoice_id
    and format=p_format and storage_path=p_path and sha256=p_sha256);
end;
$$;

-- Preserve the existing trusted observation and Part 2 interfaces without executing new Part 2 work.
alter function public.observe_bling_invoice(bigint,text,integer,text,text,timestamptz) rename to observe_bling_invoice_base;
revoke all on function public.observe_bling_invoice_base(bigint,text,integer,text,text,timestamptz) from public,anon,authenticated,service_role;
create function public.observe_bling_invoice(p_invoice_id bigint,p_order_code text,p_situation integer,p_invoice_number text,
  p_access_key text,p_observed_at timestamptz default now())
returns boolean language plpgsql security definer set search_path='' as $$
declare order_id_value uuid; current_status text;
begin
  if not public.observe_bling_invoice_base(p_invoice_id,p_order_code,p_situation,p_invoice_number,p_access_key,p_observed_at) then return false; end if;
  select l.order_id,l.invoice_status into order_id_value,current_status from private.bling_order_links l
    join public.orders o on o.id=l.order_id where l.invoice_id=p_invoice_id and o.public_code=p_order_code;
  if current_status='authorized' and p_access_key ~ '^[0-9]{44}$' then
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
      values('bling','bling.invoice.archive',jsonb_build_object('orderId',order_id_value),
        'bling:archive-invoice:'||order_id_value::text||':'||p_invoice_id::text) on conflict(idempotency_key) do nothing;
  elsif current_status in ('pending','processing') then perform public.enqueue_bling_invoice_poll(order_id_value); end if;
  return true;
end;
$$;

do $$ declare f text; begin
  foreach f in array array[
    'public.set_bling_checkout_recipient(uuid,uuid,boolean,boolean)',
    'public.read_bling_fiscal_automation_context(uuid)',
    'public.save_bling_automatic_mirror_approval(uuid,text,text,boolean,boolean)',
    'public.enqueue_bling_invoice_poll(uuid)',
    'public.read_bling_invoice_archives(uuid)',
    'public.save_bling_invoice_archive(uuid,bigint,text,text,text)',
    'public.observe_bling_invoice(bigint,text,integer,text,text,timestamptz)'
  ] loop
    execute 'revoke all on function '||f||' from public,anon,authenticated';
    execute 'grant execute on function '||f||' to service_role';
  end loop;
end; $$;
revoke all on function public.request_bling_invoice_action(uuid,text) from public,anon,service_role;
grant execute on function public.request_bling_invoice_action(uuid,text) to authenticated;
