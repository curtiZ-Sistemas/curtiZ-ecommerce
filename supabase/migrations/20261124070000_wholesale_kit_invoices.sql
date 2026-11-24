-- Notas de atacado: o contador emite, pelo painel, a NF-e de uma ficha de kit vendida a uma empresa
-- de MG que não é representante.
--
-- Decisões do dono (2026-11-24): só CNPJ de MG (IE opcional); a venda baixa o estoque de fichas do
-- kit; pagamento Pix ou dinheiro; nenhum campo fiscal para o contador (CFOP, NCM, série e natureza
-- vêm da regra MG02 já aprovada para a ficha, a mesma dos pedidos de representantes).
--
-- Depends on 20261124060000 and everything before it: kits with their own sheet stock
-- (20261123150000), grade snapshot/fingerprint (20261119180000), MG02 grade rules
-- (20261124010000) and private.is_valid_cnpj (20261124021000). Only new objects are created.

insert into public.permissions(code, description)
values ('fiscal.wholesale_invoices.issue', 'Emitir NF-e de atacado de kits para empresas de MG')
on conflict(code) do update set description = excluded.description;

insert into public.role_permissions(role, permission_id)
select 'manager', id from public.permissions where code = 'fiscal.wholesale_invoices.issue'
on conflict do nothing;
insert into public.role_permissions(role, permission_id)
select 'admin', id from public.permissions where code = 'fiscal.wholesale_invoices.issue'
on conflict do nothing;

create table private.wholesale_kit_invoices (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  kit_id uuid not null references public.kits(id),
  template text not null check (template in ('standard', 'lower_restock', 'upper_restock')),
  quantity integer not null check (quantity between 1 and 99),
  unit_price_cents integer not null check (unit_price_cents between 12 and 100000000),
  total_cents bigint not null,
  payment_method text not null check (payment_method in ('pix', 'cash')),
  buyer_snapshot jsonb not null check (jsonb_typeof(buyer_snapshot) = 'object'),
  grade_snapshot jsonb not null check (jsonb_typeof(grade_snapshot) = 'object'),
  fiscal_fingerprint text not null check (fiscal_fingerprint ~ '^[0-9a-f]{64}$'),
  rule_version_id uuid not null references private.representative_resale_fiscal_rule_versions(id),
  status text not null default 'draft' check (status in ('draft', 'issuing', 'authorized', 'error', 'cancelled')),
  stock_state text not null default 'reserved' check (stock_state in ('reserved', 'released')),
  bling_sale_id bigint unique check (bling_sale_id > 0),
  bling_invoice_id bigint unique check (bling_invoice_id > 0),
  draft_hash text check (draft_hash ~ '^[0-9a-f]{64}$'),
  invoice_number text check (invoice_number ~ '^[0-9]{1,9}$'),
  invoice_access_key text unique check (invoice_access_key ~ '^31[0-9]{42}$'),
  invoice_protocol text check (invoice_protocol ~ '^[0-9]{15}$'),
  invoice_xml_sha256 text check (invoice_xml_sha256 ~ '^[0-9a-f]{64}$'),
  error_code text check (error_code ~ '^[a-z0-9_]{3,80}$'),
  attempts integer not null default 0 check (attempts >= 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  authorized_at timestamptz,
  cancelled_at timestamptz,
  constraint wholesale_invoice_total check (total_cents = unit_price_cents::bigint * quantity),
  constraint wholesale_invoice_authorized_complete check ((status = 'authorized') = (
    invoice_access_key is not null and invoice_protocol is not null and invoice_xml_sha256 is not null
    and invoice_number is not null and authorized_at is not null)),
  constraint wholesale_invoice_stock check ((status = 'cancelled') = (stock_state = 'released'))
);
create index wholesale_kit_invoices_recent on private.wholesale_kit_invoices(created_at desc);
alter table private.wholesale_kit_invoices enable row level security;
alter table private.wholesale_kit_invoices force row level security;
revoke all on private.wholesale_kit_invoices from public, anon, authenticated, service_role;

-- One row per irreversible write to Bling: a sale and an invoice are never created twice.
create table private.wholesale_kit_invoice_writes (
  invoice_id uuid not null references private.wholesale_kit_invoices(id),
  operation text not null check (operation in ('bling_sale', 'bling_invoice_draft', 'bling_invoice_send')),
  claimed_at timestamptz not null default now(),
  primary key (invoice_id, operation)
);
alter table private.wholesale_kit_invoice_writes enable row level security;
alter table private.wholesale_kit_invoice_writes force row level security;
revoke all on private.wholesale_kit_invoice_writes from public, anon, authenticated, service_role;

create function private.require_wholesale_invoice_access()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.internal_mfa_satisfied()
    or not private.has_permission('fiscal.wholesale_invoices.issue') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.require_wholesale_invoice_access() from public, anon, authenticated, service_role;

create function private.wholesale_kit_invoice_summary(i private.wholesale_kit_invoices)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', i.id, 'status', i.status,
    'stage', case
      when i.status = 'authorized' then 'authorized'
      when exists (select 1 from private.wholesale_kit_invoice_writes w
        where w.invoice_id = i.id and w.operation = 'bling_invoice_send') then 'sent'
      when i.bling_invoice_id is not null then 'draft_in_bling'
      when i.bling_sale_id is not null then 'sale_created'
      else 'pending' end,
    'kitId', i.kit_id, 'kitName', i.grade_snapshot ->> 'kitName', 'template', i.template,
    'templateLabel', (select t.label from private.representative_kit_grade_templates() t where t.code = i.template limit 1),
    'quantity', i.quantity, 'unitPriceInCents', i.unit_price_cents, 'totalInCents', i.total_cents,
    'paymentMethod', i.payment_method,
    'buyerName', i.buyer_snapshot ->> 'name', 'buyerDocument', i.buyer_snapshot ->> 'document',
    'invoiceId', i.bling_invoice_id, 'invoiceNumber', i.invoice_number, 'invoiceKey', i.invoice_access_key,
    'authorized', i.status = 'authorized', 'errorCode', i.error_code, 'attempts', i.attempts,
    'canCancel', i.status in ('draft', 'error') and not exists (select 1 from private.wholesale_kit_invoice_writes w
      where w.invoice_id = i.id and w.operation = 'bling_invoice_send'),
    'createdAt', i.created_at);
$$;
revoke all on function private.wholesale_kit_invoice_summary(private.wholesale_kit_invoices)
  from public, anon, authenticated, service_role;

-- The worker-shaped job: same field names the kit fulfillment worker reads, so the shared fiscal
-- mirror and the authorized-XML check run unchanged. Bling ids are saleId/invoiceId.
create function private.wholesale_kit_invoice_job(i private.wholesale_kit_invoices)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'wholesaleId', i.id, 'status', i.status, 'attempts', i.attempts,
    'saleId', i.bling_sale_id, 'invoiceId', i.bling_invoice_id, 'draftHash', i.draft_hash,
    'sku', i.grade_snapshot -> 'lines' -> 0 ->> 'sku', 'productName', i.grade_snapshot ->> 'kitName',
    'quantity', i.quantity, 'gradeLines', i.grade_snapshot -> 'lines',
    'unitPriceInCents', i.unit_price_cents, 'shippingInCents', 0, 'amountInCents', i.total_cents,
    'paymentMethod', i.payment_method, 'createdAt', i.created_at,
    'originPostalCode', '35524168', 'postalCode', i.buyer_snapshot -> 'address' ->> 'postal_code',
    'buyerProfile', 'MG02', 'buyerName', i.buyer_snapshot ->> 'name', 'buyerDocument', i.buyer_snapshot ->> 'document',
    'buyerStateRegistration', coalesce(i.buyer_snapshot ->> 'registration', ''),
    'fiscalAddress', i.buyer_snapshot -> 'address',
    'fiscalParameters', r.fiscal_parameters,
    'fiscalCurrent', not exists (
      select 1 from jsonb_array_elements(i.grade_snapshot -> 'lines') line
      where private.bling_kit_source_hash((line ->> 'variantId')::uuid) is distinct from line ->> 'fiscalHash')
  )
  from private.representative_resale_fiscal_rule_versions r where r.id = i.rule_version_id;
$$;
revoke all on function private.wholesale_kit_invoice_job(private.wholesale_kit_invoices)
  from public, anon, authenticated, service_role;

-- Kits the accountant can sell: all three sheet prices configured and a reference product line.
create function public.list_wholesale_kit_offers()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_wholesale_invoice_access();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'kitId', k.id, 'name', k.name, 'description', k.description, 'color', k.grade_color, 'templates', offers.templates
    ) order by k.name, k.id), '[]'::jsonb)
    from public.kits k
    join private.representative_kit_grade_sources() s on (s.product_id, s.color) = (k.grade_product_id, k.grade_color)
    cross join lateral (
      select jsonb_agg(jsonb_build_object(
        'code', t.code, 'label', t.label, 'available', private.representative_kit_grade_stock(k, t.code),
        'sizes', t.sizes, 'unitPriceInCents', private.representative_kit_grade_price(k, t.code)
      ) order by t.sort_order) as templates
      from (
        select code, label, sort_order, jsonb_agg(jsonb_build_object('size', size, 'pairs', pairs) order by size) as sizes
        from private.representative_kit_grade_templates()
        group by code, label, sort_order
      ) t
    ) offers
    where k.active and k.deleted_at is null
      and num_nonnulls(k.grade_standard_price_cents, k.grade_lower_restock_price_cents, k.grade_upper_restock_price_cents) = 3
  );
end;
$$;

create function public.list_wholesale_kit_invoices(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r private.wholesale_kit_invoices; result jsonb := '[]'::jsonb;
begin
  perform private.require_wholesale_invoice_access();
  for r in select * from private.wholesale_kit_invoices
    order by created_at desc, id limit least(greatest(coalesce(p_limit, 50), 1), 100)
  loop
    result := result || jsonb_build_array(private.wholesale_kit_invoice_summary(r));
  end loop;
  return result;
end;
$$;

-- Creates the sale and takes the sheets from the kit stock in one transaction. Repeating the call with
-- the same key returns the same record and never takes stock twice.
create function public.create_wholesale_kit_invoice(
  p_key uuid, p_kit uuid, p_template text, p_quantity integer, p_unit_price_cents integer,
  p_payment_method text, p_buyer jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_document text; v_name text; v_registration text; v_address jsonb; v_buyer jsonb;
  v_kit public.kits; v_snapshot jsonb; v_rule private.representative_resale_fiscal_rule_versions;
  v_row private.wholesale_kit_invoices;
begin
  perform private.require_wholesale_invoice_access();
  if p_key is null or p_kit is null or p_template is null or p_template not in ('standard', 'lower_restock', 'upper_restock')
    or p_quantity is null or p_quantity not between 1 and 99
    or p_unit_price_cents is null or p_unit_price_cents not between 12 and 100000000
    or p_payment_method is null or p_payment_method not in ('pix', 'cash')
    or jsonb_typeof(p_buyer) is distinct from 'object' or jsonb_typeof(p_buyer -> 'address') is distinct from 'object' then
    raise exception 'invalid_wholesale_invoice' using errcode = '22023';
  end if;
  v_document := coalesce(p_buyer ->> 'document', '');
  v_name := btrim(coalesce(p_buyer ->> 'name', ''));
  v_registration := btrim(coalesce(p_buyer ->> 'registration', ''));
  v_address := p_buyer -> 'address';
  if not private.is_valid_cnpj(v_document) then
    raise exception 'wholesale_buyer_cnpj_invalid' using errcode = '22023';
  end if;
  if coalesce(v_address ->> 'state', '') <> 'MG' or coalesce(v_address ->> 'postal_code', '') !~ '^3[0-9]{7}$' then
    raise exception 'wholesale_buyer_outside_mg' using errcode = '23514';
  end if;
  if length(v_name) not between 2 and 180 or (v_registration <> '' and v_registration !~ '^[0-9]{2,14}$')
    or length(btrim(coalesce(v_address ->> 'street', ''))) not between 1 and 180
    or length(btrim(coalesce(v_address ->> 'number', ''))) not between 1 and 30
    or length(btrim(coalesce(v_address ->> 'district', ''))) not between 1 and 100
    or length(btrim(coalesce(v_address ->> 'city', ''))) not between 1 and 100
    or length(btrim(coalesce(v_address ->> 'complement', ''))) > 100 then
    raise exception 'invalid_wholesale_invoice' using errcode = '22023';
  end if;
  v_buyer := jsonb_build_object('document', v_document, 'name', v_name, 'registration', v_registration,
    'address', jsonb_build_object('state', 'MG', 'postal_code', v_address ->> 'postal_code',
      'street', btrim(v_address ->> 'street'), 'number', btrim(v_address ->> 'number'),
      'district', btrim(v_address ->> 'district'), 'city', btrim(v_address ->> 'city'),
      'complement', btrim(coalesce(v_address ->> 'complement', ''))));

  perform pg_advisory_xact_lock(hashtextextended('wholesale-kit-invoice:' || p_key::text, 0));
  select * into v_row from private.wholesale_kit_invoices where idempotency_key = p_key;
  if found then
    if (v_row.kit_id, v_row.template, v_row.quantity, v_row.unit_price_cents, v_row.payment_method, v_row.created_by,
        v_row.buyer_snapshot ->> 'document')
      is distinct from (p_kit, p_template, p_quantity, p_unit_price_cents, p_payment_method, auth.uid(), v_document) then
      raise exception 'wholesale_idempotency_conflict' using errcode = '23505';
    end if;
    return private.wholesale_kit_invoice_summary(v_row);
  end if;

  -- The kit row is the stock ledger: locking it serializes competing sales.
  select * into v_kit from public.kits k where k.id = p_kit and k.active and k.deleted_at is null for update;
  if not found or v_kit.grade_product_id is null
    or num_nonnulls(v_kit.grade_standard_price_cents, v_kit.grade_lower_restock_price_cents, v_kit.grade_upper_restock_price_cents) <> 3 then
    raise exception 'wholesale_kit_unavailable' using errcode = '23514';
  end if;
  if coalesce(private.representative_kit_grade_stock(v_kit, p_template), 0) < p_quantity then
    raise exception 'kit_grade_out_of_stock' using errcode = '23514';
  end if;
  v_snapshot := private.representative_kit_grade_snapshot(p_kit, p_template);
  if v_snapshot is null then raise exception 'wholesale_kit_unavailable' using errcode = '23514'; end if;

  -- Same owner-approved MG02 no-credit rule (CFOP 5102, CSOSN 102, series 3) the representatives' kits use.
  perform private.ensure_representative_kit_grade_mg02_rules();
  select rule.* into v_rule from private.representative_resale_fiscal_rule_versions rule
    join private.representative_resale_fiscal_rule_approvals evidence on evidence.rule_version_id = rule.id
    left join private.representative_resale_fiscal_rule_revocations revoked on revoked.rule_version_id = rule.id
    where rule.product_fingerprint = v_snapshot ->> 'fiscalFingerprint'
      and rule.origin_state = 'MG' and rule.destination_state = 'MG' and rule.person_type = 'business'
      and rule.icms_status = 'taxpayer' and not rule.final_consumer and rule.purpose = 'resale'
      and rule.valid_from <= statement_timestamp() and statement_timestamp() < rule.valid_until
      and revoked.rule_version_id is null
      and rule.fiscal_parameters ->> 'buyerProfile' = 'MG02'
      and rule.fiscal_parameters -> 'creditEligible' = 'false'::jsonb
      and rule.fiscal_parameters ->> 'issuerDocument' ~ '^[0-9]{14}$'
      and rule.fiscal_parameters #>> '{blingRule,scenario}' = 'resale_in_state_no_credit'
      and rule.fiscal_parameters #>> '{blingRule,series}' = '3'
      and rule.fiscal_parameters #>> '{blingRule,cfop}' = '5102'
      and rule.fiscal_parameters #>> '{blingRule,csosn}' = '102'
    order by rule.created_at, rule.id limit 1;
  if not found then raise exception 'resale_not_homologated' using errcode = '23514'; end if;

  update public.kits k set
    grade_standard_stock = k.grade_standard_stock - case when p_template = 'standard' then p_quantity else 0 end,
    grade_lower_restock_stock = k.grade_lower_restock_stock - case when p_template = 'lower_restock' then p_quantity else 0 end,
    grade_upper_restock_stock = k.grade_upper_restock_stock - case when p_template = 'upper_restock' then p_quantity else 0 end
    where k.id = p_kit and private.representative_kit_grade_stock(k, p_template) >= p_quantity;
  if not found then raise exception 'kit_grade_out_of_stock' using errcode = '23514'; end if;

  insert into private.wholesale_kit_invoices(
    idempotency_key, kit_id, template, quantity, unit_price_cents, total_cents, payment_method,
    buyer_snapshot, grade_snapshot, fiscal_fingerprint, rule_version_id, created_by
  ) values (
    p_key, p_kit, p_template, p_quantity, p_unit_price_cents, p_unit_price_cents::bigint * p_quantity, p_payment_method,
    v_buyer, v_snapshot, v_snapshot ->> 'fiscalFingerprint', v_rule.id, auth.uid()
  ) returning * into v_row;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, new_data_sanitized)
    values (auth.uid(), private.current_app_role(), 'fiscal.wholesale_invoice.created', 'wholesale_kit_invoice', v_row.id,
      jsonb_build_object('template', p_template, 'quantity', p_quantity, 'totalInCents', v_row.total_cents,
        'paymentMethod', p_payment_method));
  return private.wholesale_kit_invoice_summary(v_row);
end;
$$;

-- Lets the operator run the issue again after an error (or a stalled attempt).
create function public.request_wholesale_kit_invoice_retry(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_wholesale_invoice_access();
  update private.wholesale_kit_invoices set status = 'draft', error_code = null, updated_at = now()
    where id = p_id and (status in ('draft', 'error') or (status = 'issuing' and updated_at < now() - interval '3 minutes'))
      and stock_state = 'reserved';
  return found;
end;
$$;

-- Only before the invoice is transmitted: gives the sheets back once. The result says whether a sale or
-- draft already exists in Bling, because those are removed there by hand.
create function public.cancel_wholesale_kit_invoice(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i private.wholesale_kit_invoices;
begin
  perform private.require_wholesale_invoice_access();
  select * into i from private.wholesale_kit_invoices where id = p_id for update;
  if not found then return jsonb_build_object('ok', false); end if;
  if i.status = 'cancelled' then return jsonb_build_object('ok', true, 'blingResidue', false); end if;
  if i.status not in ('draft', 'error') or i.stock_state <> 'reserved'
    or exists (select 1 from private.wholesale_kit_invoice_writes w
      where w.invoice_id = i.id and w.operation = 'bling_invoice_send') then
    return jsonb_build_object('ok', false);
  end if;
  update public.kits k set
    grade_standard_stock = k.grade_standard_stock + case when i.template = 'standard' then i.quantity else 0 end,
    grade_lower_restock_stock = k.grade_lower_restock_stock + case when i.template = 'lower_restock' then i.quantity else 0 end,
    grade_upper_restock_stock = k.grade_upper_restock_stock + case when i.template = 'upper_restock' then i.quantity else 0 end
    where k.id = i.kit_id;
  if not found then raise exception 'kit_stock_inconsistent' using errcode = '23514'; end if;
  update private.wholesale_kit_invoices set status = 'cancelled', stock_state = 'released',
    cancelled_at = now(), updated_at = now() where id = i.id;
  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, new_data_sanitized)
    values (auth.uid(), private.current_app_role(), 'fiscal.wholesale_invoice.cancelled', 'wholesale_kit_invoice', i.id,
      jsonb_build_object('quantity', i.quantity, 'blingResidue', i.bling_sale_id is not null));
  return jsonb_build_object('ok', true, 'blingResidue', i.bling_sale_id is not null);
end;
$$;

-- Worker side (service role). Starting an attempt moves draft/error to issuing and returns the job;
-- null means another attempt is running or the record is not issuable.
create function public.begin_wholesale_kit_invoice_issue(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i private.wholesale_kit_invoices;
begin
  select * into i from private.wholesale_kit_invoices where id = p_id for update;
  if not found or i.stock_state <> 'reserved' or i.status = 'authorized'
    or (i.status = 'issuing' and i.updated_at > now() - interval '3 minutes')
    or i.status = 'cancelled' then return null; end if;
  update private.wholesale_kit_invoices set status = 'issuing', error_code = null, attempts = attempts + 1, updated_at = now()
    where id = i.id returning * into i;
  return private.wholesale_kit_invoice_job(i);
end;
$$;

create function public.read_wholesale_kit_invoice_job(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.wholesale_kit_invoice_job(i) from private.wholesale_kit_invoices i where i.id = p_id;
$$;

create function public.claim_wholesale_kit_invoice_write(p_id uuid, p_operation text, p_expected_hash text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare i private.wholesale_kit_invoices;
begin
  select * into i from private.wholesale_kit_invoices where id = p_id for update;
  if not found or i.status <> 'issuing' or p_operation is null then return false; end if;
  if not (case p_operation
    when 'bling_sale' then i.bling_sale_id is null
    when 'bling_invoice_draft' then i.bling_sale_id is not null and i.bling_invoice_id is null
    when 'bling_invoice_send' then i.bling_invoice_id is not null and i.invoice_access_key is null
      and p_expected_hash is not null and i.draft_hash is not distinct from p_expected_hash
    else false end) then return false; end if;
  insert into private.wholesale_kit_invoice_writes(invoice_id, operation) values (p_id, p_operation) on conflict do nothing;
  return found;
end;
$$;

create function public.record_wholesale_kit_invoice_sale(p_id uuid, p_sale bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_sale is null or p_sale <= 0 then return false; end if;
  update private.wholesale_kit_invoices set bling_sale_id = p_sale, updated_at = now()
    where id = p_id and status = 'issuing' and (bling_sale_id is null or bling_sale_id = p_sale);
  return found;
end;
$$;

create function public.record_wholesale_kit_invoice_draft(p_id uuid, p_sale bigint, p_invoice bigint, p_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_invoice is null or p_invoice <= 0 or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  update private.wholesale_kit_invoices set bling_invoice_id = p_invoice, draft_hash = p_hash, updated_at = now()
    where id = p_id and status = 'issuing' and bling_sale_id = p_sale
      and (bling_invoice_id is null or bling_invoice_id = p_invoice)
      and not exists (select 1 from private.wholesale_kit_invoice_writes w
        where w.invoice_id = p_id and w.operation = 'bling_invoice_send');
  return found;
end;
$$;

create function public.record_wholesale_kit_invoice_authorized(
  p_id uuid, p_sale bigint, p_invoice bigint, p_key text, p_protocol text, p_sha256 text, p_number text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare i private.wholesale_kit_invoices;
begin
  if p_key is null or p_key !~ '^31[0-9]{42}$' or substr(p_key, 21, 5) <> '55003'
    or p_protocol is null or p_protocol !~ '^[0-9]{15}$'
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_number is null or p_number !~ '^[0-9]{1,9}$' then return false; end if;
  update private.wholesale_kit_invoices set status = 'authorized', invoice_access_key = p_key, invoice_protocol = p_protocol,
      invoice_xml_sha256 = p_sha256, invoice_number = p_number, error_code = null, authorized_at = now(), updated_at = now()
    where id = p_id and status = 'issuing' and bling_sale_id = p_sale and bling_invoice_id = p_invoice and stock_state = 'reserved'
    returning * into i;
  if not found then return false; end if;
  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, new_data_sanitized)
    values (null, null, 'fiscal.wholesale_invoice.authorized', 'wholesale_kit_invoice', i.id,
      jsonb_build_object('totalInCents', i.total_cents, 'series', 3));
  return true;
end;
$$;

-- p_status 'draft' = waiting for something outside the app (for example Bling sending turned off);
-- 'error' = needs the operator. The code is a fixed reason, never provider text or personal data.
create function public.record_wholesale_kit_invoice_progress(p_id uuid, p_status text, p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_status is null or p_status not in ('draft', 'error') or p_code is null or p_code !~ '^[a-z0-9_]{3,80}$' then return false; end if;
  update private.wholesale_kit_invoices set status = p_status, error_code = p_code, updated_at = now()
    where id = p_id and status = 'issuing';
  if found and p_status = 'error' then
    insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, new_data_sanitized)
      values (null, null, 'fiscal.wholesale_invoice.error', 'wholesale_kit_invoice', p_id, jsonb_build_object('reason', p_code));
  end if;
  return found;
end;
$$;

revoke all on function public.list_wholesale_kit_offers(), public.list_wholesale_kit_invoices(integer),
  public.create_wholesale_kit_invoice(uuid, uuid, text, integer, integer, text, jsonb),
  public.request_wholesale_kit_invoice_retry(uuid), public.cancel_wholesale_kit_invoice(uuid)
  from public, anon, service_role;
grant execute on function public.list_wholesale_kit_offers(), public.list_wholesale_kit_invoices(integer),
  public.create_wholesale_kit_invoice(uuid, uuid, text, integer, integer, text, jsonb),
  public.request_wholesale_kit_invoice_retry(uuid), public.cancel_wholesale_kit_invoice(uuid)
  to authenticated;

revoke all on function public.begin_wholesale_kit_invoice_issue(uuid), public.read_wholesale_kit_invoice_job(uuid),
  public.claim_wholesale_kit_invoice_write(uuid, text, text), public.record_wholesale_kit_invoice_sale(uuid, bigint),
  public.record_wholesale_kit_invoice_draft(uuid, bigint, bigint, text),
  public.record_wholesale_kit_invoice_authorized(uuid, bigint, bigint, text, text, text, text),
  public.record_wholesale_kit_invoice_progress(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.begin_wholesale_kit_invoice_issue(uuid), public.read_wholesale_kit_invoice_job(uuid),
  public.claim_wholesale_kit_invoice_write(uuid, text, text), public.record_wholesale_kit_invoice_sale(uuid, bigint),
  public.record_wholesale_kit_invoice_draft(uuid, bigint, bigint, text),
  public.record_wholesale_kit_invoice_authorized(uuid, bigint, bigint, text, text, text, text),
  public.record_wholesale_kit_invoice_progress(uuid, text, text)
  to service_role;

notify pgrst, 'reload schema';
