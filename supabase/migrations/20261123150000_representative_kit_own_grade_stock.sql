-- Kits keep their own stock of complete sheets (fichas). It is no longer taken
-- from the single-SKU product inventory. grade_product_id/grade_color are the
-- reference product line, required for the kit to be offered, and are used only for
-- fiscal data (NCM, fingerprint), weight and dimensions, never for stock.
alter table public.kits
  add column grade_standard_stock integer not null default 0 check (grade_standard_stock >= 0),
  add column grade_lower_restock_stock integer not null default 0 check (grade_lower_restock_stock >= 0),
  add column grade_upper_restock_stock integer not null default 0 check (grade_upper_restock_stock >= 0);

-- Prices no longer depend on a stock line: all three prices or none.
alter table public.kits drop constraint kit_grade_prices_complete;
alter table public.kits add constraint kit_grade_prices_complete check (
  num_nonnulls(grade_standard_price_cents, grade_lower_restock_price_cents, grade_upper_restock_price_cents) in (0, 3)
);

-- Orders reserved before this migration released variant stock; new ones use the kit.
alter table private.representative_kit_orders
  add column grade_stock_source text not null default 'variants' check (grade_stock_source in ('variants', 'kit')),
  add constraint representative_kit_order_stock_source
    check (grade_stock_source = 'variants' or grade_kit_id is not null);

create function private.representative_kit_grade_stock(p_kit public.kits, p_template text)
returns integer language sql immutable set search_path = ''
as $$
  select case p_template
    when 'standard' then p_kit.grade_standard_stock
    when 'lower_restock' then p_kit.grade_lower_restock_stock
    when 'upper_restock' then p_kit.grade_upper_restock_stock
  end;
$$;
revoke all on function private.representative_kit_grade_stock(public.kits, text) from public, anon, authenticated, service_role;

create or replace function public.list_representative_kit_grade_offers()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kitId', k.id, 'name', k.name, 'description', k.description, 'color', k.grade_color,
    'unitPriceInCents', private.representative_kit_grade_price(k, 'standard'), 'templates', offers.templates
  ) order by k.name, k.id), '[]'::jsonb)
  from public.kits k
  -- The reference product line supplies NCM, weight, dimensions and the fiscal fingerprint
  -- only; it must exist so that the purchase can be quoted, but its stock is never read.
  join private.representative_kit_grade_sources() s on (s.product_id, s.color) = (k.grade_product_id, k.grade_color)
  cross join lateral (
    select jsonb_agg(jsonb_build_object(
      'code', t.code, 'label', t.label, 'available', private.representative_kit_grade_stock(k, t.code),
      'sizes', t.sizes, 'unitPriceInCents', private.representative_kit_grade_price(k, t.code)
    ) order by t.sort_order) as templates
    from (
      select code, label, sort_order,
        jsonb_agg(jsonb_build_object('size', size, 'pairs', pairs) order by size) as sizes
      from private.representative_kit_grade_templates()
      group by code, label, sort_order
    ) t
  ) offers
  where k.active and k.deleted_at is null
    and num_nonnulls(k.grade_standard_price_cents, k.grade_lower_restock_price_cents, k.grade_upper_restock_price_cents) = 3
    and private.representative_catalog_access();
$$;

-- Same checks as before, except that availability now comes from the kit's own stock.
create or replace function public.read_representative_kit_grade_shipping(
  p_actor uuid, p_kit uuid, p_template text, p_quantity integer, p_address uuid, p_origin text
) returns jsonb language sql stable security definer set search_path = ''
as $$
  select listing.snapshot || jsonb_build_object(
    'postalCode', regexp_replace(a.postal_code, '[^0-9]', '', 'g'), 'addressVersion', a.updated_at,
    'purchaseAvailable', coalesce(rule.id is not null and private.representative_kit_commercial_configuration(p_actor,rule.id)
      and approval.buyer_fiscal_address ->> 'state' = 'MG', false)
  )
  from public.profiles p
  join public.representatives r on r.user_id = p.id and r.status in ('approved_waiting_kit', 'active', 'unqualified')
  join public.addresses a on a.user_id = p.id and a.id = p_address
  cross join lateral (select private.representative_kit_grade_snapshot(p_kit, p_template) as snapshot) listing
  cross join lateral (select private.find_representative_kit_approval_by_fingerprint(
    p_actor, listing.snapshot ->> 'fiscalFingerprint', p_origin) as id) rule
  left join private.representative_kit_checkout_approvals approval on approval.actor_id = p_actor and approval.rule_version_id = rule.id
  where p.id = p_actor and p.status = 'active' and a.state = 'MG' and a.country = 'BR'
    and regexp_replace(a.postal_code, '[^0-9]', '', 'g') ~ '^3[0-9]{7}$' and p_origin ~ '^3[0-9]{7}$'
    and p_quantity between 1 and 99 and listing.snapshot is not null
    and exists (
      select 1 from public.kits k
      where k.id = p_kit and k.active and k.deleted_at is null
        and private.representative_kit_grade_stock(k, p_template) >= p_quantity
    );
$$;

-- Reserving a sheet now takes N complete sheets from the kit's stock, atomically.
create or replace function private.reserve_representative_kit_grade_order(
  p_actor uuid,p_kit uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  shipping jsonb;
  quote private.representative_kit_shipping_checkout_quotes;
  placed private.representative_kit_orders;
  delivery public.addresses;
  rule_id uuid;
  locked_kit public.kits;
begin
  if p_actor is null or p_key is null or p_kit is null or p_template is null
    or p_quantity is null or p_quantity not between 1 and 99 or p_origin is null or p_origin !~ '^3[0-9]{7}$' then
    raise exception 'invalid_kit_request' using errcode = '22023';
  end if;

  perform 1 from public.profiles p join public.representatives r on r.user_id = p.id
    where p.id = p_actor and p.status = 'active' and r.status in ('approved_waiting_kit','active','unqualified')
    for share of p, r;
  if not found then raise exception 'kit_access_denied' using errcode = '42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended('representative-kit:'||p_actor::text||':'||p_key::text,0));
  select * into placed from private.representative_kit_orders where actor_id=p_actor and idempotency_key=p_key;
  if found then
    if (placed.grade_kit_id,placed.grade_template,placed.quantity,placed.quote_id,placed.address_id)
       is distinct from (p_kit,p_template,p_quantity,p_quote,p_address) then
      raise exception 'kit_idempotency_conflict' using errcode = '23505';
    end if;
    return private.representative_kit_order_summary(placed);
  end if;

  -- The kit row is the stock ledger: locking it serializes competing reservations.
  select * into locked_kit from public.kits k where k.id=p_kit and k.active and k.deleted_at is null for update;
  if not found then raise exception 'kit_grade_unavailable' using errcode = '23514'; end if;
  if private.representative_kit_grade_stock(locked_kit,p_template) is null
    or private.representative_kit_grade_stock(locked_kit,p_template) < p_quantity then
    raise exception 'kit_grade_out_of_stock' using errcode = '23514';
  end if;
  -- Optional fiscal/shipping reference line; it is locked for consistency but holds no stock.
  perform 1 from public.kits k join public.products p on p.id=k.grade_product_id
    join private.bling_catalog_metadata m on m.product_id=p.id
    join public.product_variants v on v.product_id=p.id and v.color_name=k.grade_color
    where k.id=p_kit order by v.id for share of v,p,m;

  select * into delivery from public.addresses a
    where a.id=p_address and a.user_id=p_actor and a.country='BR' and a.state='MG'
    for share;
  if not found then raise exception 'kit_access_denied' using errcode = '42501'; end if;

  select * into quote from private.representative_kit_shipping_checkout_quotes q
    where q.id=p_quote and q.actor_id=p_actor and q.grade_kit_id=p_kit and q.grade_template=p_template
      and q.quantity=p_quantity and q.address_id=p_address and q.address_updated_at=delivery.updated_at
      and q.origin_postal_code=p_origin and q.used_at is null and q.expires_at>clock_timestamp()
    for update;
  if not found then raise exception 'kit_quote_unavailable' using errcode = '23514'; end if;
  shipping := public.read_representative_kit_grade_shipping(p_actor,p_kit,p_template,p_quantity,p_address,p_origin);
  if shipping is null or shipping ->> 'catalogHash' is distinct from quote.grade_catalog_hash
    or shipping ->> 'postalCode' is distinct from quote.postal_code then
    raise exception 'kit_grade_quote_changed' using errcode = '23514';
  end if;
  rule_id := private.find_representative_kit_approval_by_fingerprint(p_actor,shipping ->> 'fiscalFingerprint',p_origin);
  if rule_id is null then raise exception 'resale_not_homologated' using errcode = '23514'; end if;

  update public.kits k set
    grade_standard_stock=k.grade_standard_stock-case when p_template='standard' then p_quantity else 0 end,
    grade_lower_restock_stock=k.grade_lower_restock_stock-case when p_template='lower_restock' then p_quantity else 0 end,
    grade_upper_restock_stock=k.grade_upper_restock_stock-case when p_template='upper_restock' then p_quantity else 0 end
    where k.id=p_kit and private.representative_kit_grade_stock(k,p_template)>=p_quantity;
  if not found then raise exception 'kit_grade_out_of_stock' using errcode = '23514'; end if;

  update private.representative_kit_shipping_checkout_quotes set used_at=now() where id=quote.id;
  insert into private.representative_kit_orders (
    actor_id,variant_id,quantity,quote_id,address_id,idempotency_key,rule_version_id,
    sku,product_name,unit_price_cents,shipping_cents,shipping_snapshot,reserved_until,
    grade_kit_id,grade_template,grade_fiscal_fingerprint,grade_lines,grade_stock_source
  ) values (
    p_actor,quote.variant_id,p_quantity,p_quote,p_address,p_key,rule_id,
    shipping -> 'lines' -> 0 ->> 'sku',shipping ->> 'kitName',quote.merchandise_unit_cents,quote.amount_in_cents,
    jsonb_build_object('provider','melhorenvio','originPostalCode',p_origin,
      'serviceId',quote.service_id,'service',quote.service,'carrier',quote.carrier,'packages',quote.packages,
      'costInCents',quote.cost_in_cents,'estimatedDays',quote.estimated_days,
      'address',jsonb_build_object('state','MG','postalCode',quote.postal_code,'version',delivery.updated_at)),
    least(quote.expires_at,clock_timestamp()+interval '15 minutes'),
    p_kit,p_template,shipping ->> 'fiscalFingerprint',shipping -> 'lines','kit'
  ) returning * into placed;
  return private.representative_kit_order_summary(placed);
end;
$$;

-- Every release, sale and restock of a stock reservation passes through here.
-- Kit-sourced orders move the kit's sheet stock; older orders keep using the variants.
create or replace function private.transfer_representative_kit_inventory(
  o private.representative_kit_orders, p_count integer, p_operation text,
  p_reason text, p_reference_type text, p_reference_id uuid, p_operator uuid
) returns void language plpgsql set search_path = ''
as $$
declare
  line record;
  available integer;
  reserved integer;
begin
  if p_count is null or p_count not between 1 and o.quantity
    or p_operation is null or p_operation not in ('release','sell','restock') then
    raise exception 'kit_stock_operation_invalid' using errcode='23514';
  end if;

  if o.grade_stock_source = 'kit' then
    -- The reservation already left the kit's stock; selling it changes nothing.
    if p_operation = 'sell' then return; end if;
    update public.kits k set
      grade_standard_stock=k.grade_standard_stock+case when o.grade_template='standard' then p_count else 0 end,
      grade_lower_restock_stock=k.grade_lower_restock_stock+case when o.grade_template='lower_restock' then p_count else 0 end,
      grade_upper_restock_stock=k.grade_upper_restock_stock+case when o.grade_template='upper_restock' then p_count else 0 end
      where k.id=o.grade_kit_id;
    if not found then raise exception 'kit_stock_inconsistent' using errcode='23514'; end if;
    return;
  end if;

  for line in
    select stock.variant_id, stock.pairs*p_count as units
    from (
      select o.variant_id as variant_id, 1 as pairs where o.grade_lines is null
      union all
      select (item ->> 'variantId')::uuid, (item ->> 'pairs')::integer
      from jsonb_array_elements(o.grade_lines) item
    ) stock
    order by stock.variant_id
  loop
    update public.inventory
      set reserved_quantity=reserved_quantity-case when p_operation='restock' then 0 else line.units end,
        available_quantity=available_quantity+case when p_operation='sell' then 0 else line.units end,
        version=version+1,updated_at=now()
      where variant_id=line.variant_id and (p_operation='restock' or reserved_quantity>=line.units)
      returning available_quantity,reserved_quantity into available,reserved;
    if not found then raise exception 'kit_stock_inconsistent' using errcode='23514'; end if;
    if p_operation='sell' then
      insert into public.inventory_movements(variant_id,movement_type,quantity,previous_quantity,new_quantity,
        reason,reference_type,reference_id,performed_by)
      values(line.variant_id,'sale',-line.units,available+reserved+line.units,available+reserved,
        p_reason,p_reference_type,p_reference_id,p_operator);
    elsif p_operation='restock' then
      insert into public.inventory_movements(variant_id,movement_type,quantity,previous_quantity,new_quantity,
        reason,reference_type,reference_id,performed_by)
      values(line.variant_id,'return',line.units,available-line.units,available,
        p_reason,p_reference_type,p_reference_id,p_operator);
    end if;
  end loop;
end;
$$;

-- A returned loose pair cannot rebuild a complete sheet, so pair returns of
-- kit-sourced orders do not touch the kit's sheet stock. Everything else is unchanged.
create or replace function private.finalize_representative_kit_return()
returns trigger language plpgsql set search_path = '' as $$
declare
  r private.representative_kit_returns;
  o private.representative_kit_orders;
  stock_order private.representative_kit_orders;
begin
  if new.reason <> 'accepted_return' then return new; end if;
  if tg_when='BEFORE' then
    if old.started_at is null and new.started_at is not null and not exists(
      select 1 from private.representative_kit_returns q where q.id=new.kit_return_id and q.order_id=new.order_id
        and q.state='refund_pending' and q.invoice_key=new.return_invoice_key and q.refund_cents=new.amount_cents
        and q.invoice_protocol is not null and q.invoice_sha256 is not null
    ) then raise exception 'kit_return_verification_required' using errcode='23514'; end if;
    return new;
  end if;
  if old.provider_refund_id is not null or new.provider_refund_id is null then return new; end if;
  select * into o from private.representative_kit_orders where id=new.order_id for update;
  select * into r from private.representative_kit_returns where id=new.kit_return_id for update;
  if not found or r.state<>'refund_pending' or r.order_id<>o.id or (r.requested_pairs is null and o.returned_kit_count+r.quantity>o.quantity)
    then raise exception 'kit_return_stock_mismatch' using errcode='23514'; end if;
  if r.requested_pairs is not null then
    if r.restock_pairs is null or r.fiscal_return_lines is null or o.grade_lines is null
      then raise exception 'kit_return_stock_mismatch' using errcode='23514'; end if;
    stock_order := o;
    select jsonb_agg(line || jsonb_build_object('pairs',(r.restock_pairs->>(line->>'sku'))::integer))
      into stock_order.grade_lines
      from jsonb_array_elements(o.grade_lines) as grade(line) where r.restock_pairs ? (line->>'sku');
    if stock_order.grade_lines is not null and o.grade_stock_source <> 'kit' then
      perform private.transfer_representative_kit_inventory(stock_order,1,'restock',
        'Devolução inspecionada de pares de revenda MG','representative_kit_return',r.id,r.inspected_by);
    end if;
  else
    update private.representative_kit_orders set returned_kit_count=returned_kit_count+r.quantity,
      stock_state=case when returned_kit_count+r.quantity=quantity then 'released' else stock_state end where id=o.id;
    if r.restock_quantity>0 then
      perform private.transfer_representative_kit_inventory(o,r.restock_quantity,'restock',
        'Devolução inspecionada de kit de revenda MG','representative_kit_return',r.id,r.inspected_by);
    end if;
  end if;
  update private.representative_kit_returns set state='completed' where id=r.id;
  if o.grade_lines is not null and not exists (
    select 1 from jsonb_array_elements(o.grade_lines) as grade(line)
    where (line->>'pairs')::integer*o.quantity <> (
      select coalesce(sum(case when completed.requested_pairs is null then (line->>'pairs')::integer*completed.quantity
        else coalesce((completed.requested_pairs->>(line->>'sku'))::integer,0) end),0)
      from private.representative_kit_returns completed where completed.order_id=o.id and completed.state='completed'
    )
  ) then update private.representative_kit_orders set stock_state='released' where id=o.id; end if;
  return new;
end;
$$;

-- A representative waiting for the first kit becomes active when a kit order is
-- confirmed as paid. The legacy required_for_activation flag is not consulted.
-- Other statuses (active, suspended, inactive, unqualified) are never changed.
create function private.activate_representative_after_kit_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  activated public.representatives;
begin
  if new.state <> 'paid' or old.state is not distinct from new.state then return new; end if;
  update public.representatives set status='active', activated_at=coalesce(activated_at,now()), updated_at=now()
    where user_id=new.actor_id and status='approved_waiting_kit'
    returning * into activated;
  if not found then return new; end if;
  insert into public.representative_status_history(representative_id,previous_status,new_status,reason)
    values(activated.id,'approved_waiting_kit','active','Ativação automática após o pagamento do primeiro kit');
  insert into public.audit_logs(action,entity_type,entity_id,new_data_sanitized)
    values('representative.activated_by_kit_payment','representative',activated.id,
      jsonb_build_object('orderId',new.id,'previousStatus','approved_waiting_kit','newStatus','active'));
  return new;
end;
$$;
revoke all on function private.activate_representative_after_kit_payment() from public, anon, authenticated, service_role;
create trigger activate_representative_after_kit_payment after update of state on private.representative_kit_orders
  for each row execute function private.activate_representative_after_kit_payment();
