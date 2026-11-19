alter table private.representative_kit_shipping_checkout_quotes
  add column grade_kit_id uuid references public.kits(id),
  add column grade_template text,
  add column grade_catalog_hash text check (grade_catalog_hash ~ '^[a-f0-9]{64}$'),
  add constraint representative_kit_quote_grade_complete
    check (num_nonnulls(grade_kit_id, grade_template, grade_catalog_hash) in (0, 3));

create index representative_kit_shipping_quotes_grade_kit
  on private.representative_kit_shipping_checkout_quotes (grade_kit_id) where grade_kit_id is not null;

alter table private.representative_kit_orders
  add column grade_kit_id uuid references public.kits(id),
  add column grade_template text,
  add column grade_fiscal_fingerprint text check (grade_fiscal_fingerprint ~ '^[a-f0-9]{64}$'),
  add column grade_lines jsonb check (jsonb_typeof(grade_lines) = 'array' and jsonb_array_length(grade_lines) between 3 and 6),
  add constraint representative_kit_order_grade_complete
    check (num_nonnulls(grade_kit_id, grade_template, grade_fiscal_fingerprint, grade_lines) in (0, 4));

create index representative_kit_orders_grade_kit
  on private.representative_kit_orders (grade_kit_id) where grade_kit_id is not null;

create function private.representative_kit_grade_snapshot(p_kit uuid, p_template text)
returns jsonb
language sql stable set search_path = ''
as $$
  with components as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'variantId', c.variant_id, 'productId', v.product_id, 'size', c.size, 'pairs', c.pairs,
      'sku', v.sku, 'name', p.name, 'priceCents', inputs.price_cents, 'dimensions', inputs.dimensions,
      'fiscalHash', private.bling_kit_source_hash(v.id)
    ) order by c.variant_id), '[]'::jsonb) as lines,
    coalesce(sum(c.pairs), 0) as pairs
    from private.representative_kit_grade_components(p_kit, p_template) c
    join public.product_variants v on v.id = c.variant_id
    join public.products p on p.id = v.product_id
    join lateral private.representative_kit_shipping_inputs(v.id) inputs on inputs.price_cents > 0
  )
  select jsonb_build_object(
    'kitName', k.name, 'priceCents', k.price_in_cents, 'lines', components.lines,
    'catalogHash', encode(sha256(convert_to(jsonb_build_array(k.id, k.name, p_template,
      k.price_in_cents, components.lines)::text, 'UTF8')), 'hex'),
    'fiscalFingerprint', encode(sha256(convert_to(jsonb_build_array(k.id, p_template, (
      select jsonb_agg(jsonb_build_array(line -> 'variantId', line -> 'pairs', line -> 'fiscalHash') order by line ->> 'variantId')
      from jsonb_array_elements(components.lines) line
    ))::text, 'UTF8')), 'hex')
  )
  from public.kits k cross join components
  where k.id = p_kit and k.price_in_cents > 0 and components.pairs = 12;
$$;
revoke all on function private.representative_kit_grade_snapshot(uuid, text) from public, anon, authenticated, service_role;

create function private.find_representative_kit_approval_by_fingerprint(p_actor uuid, p_fingerprint text, p_origin text)
returns uuid language sql stable set search_path = ''
as $$
  select case when count(*) = 1 then (array_agg(r.id))[1] end
  from private.representative_kit_checkout_approvals a
  join private.representative_resale_fiscal_rule_versions r on r.id = a.rule_version_id
  join private.representative_resale_fiscal_rule_approvals e on e.rule_version_id = r.id
  left join private.representative_resale_fiscal_rule_revocations v on v.rule_version_id = r.id
  where a.actor_id = p_actor and a.revoked_at is null and a.valid_until > statement_timestamp()
    and a.origin_postal_code = p_origin and a.buyer_fiscal_state = 'MG'
    and e.approved_at <= statement_timestamp() and v.rule_version_id is null
    and r.origin_state = 'MG' and r.destination_state = 'MG' and r.person_type = 'business'
    and r.icms_status = 'taxpayer' and r.purpose = 'resale' and not r.final_consumer
    and r.fiscal_parameters ->> 'buyerProfile' = a.buyer_profile
    and statement_timestamp() >= r.valid_from and statement_timestamp() < r.valid_until
    and r.product_fingerprint = p_fingerprint;
$$;
revoke all on function private.find_representative_kit_approval_by_fingerprint(uuid, text, text) from public, anon, authenticated, service_role;

create or replace function private.find_representative_kit_checkout_approval(p_actor uuid, p_variant uuid, p_origin text)
returns uuid language sql stable set search_path = ''
as $$
  select private.find_representative_kit_approval_by_fingerprint(
    p_actor, public.read_representative_resale_product_fingerprint(p_variant), p_origin
  );
$$;

create function public.read_representative_kit_grade_fingerprint(p_kit uuid, p_template text)
returns text language sql stable security definer set search_path = ''
as $$
  select private.representative_kit_grade_snapshot(p_kit, p_template) ->> 'fiscalFingerprint';
$$;
revoke all on function public.read_representative_kit_grade_fingerprint(uuid, text) from public, anon, authenticated;
grant execute on function public.read_representative_kit_grade_fingerprint(uuid, text) to service_role;

create function public.read_representative_kit_grade_shipping(
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
    and not exists (
      select 1 from private.representative_kit_grade_components(p_kit, p_template) c
      where c.available < c.pairs * p_quantity
    );
$$;
revoke all on function public.read_representative_kit_grade_shipping(uuid,uuid,text,integer,uuid,text) from public, anon, authenticated;
grant execute on function public.read_representative_kit_grade_shipping(uuid,uuid,text,integer,uuid,text) to service_role;

create function public.confirm_representative_kit_grade_shipping(
  p_actor uuid, p_kit uuid, p_template text, p_quantity integer, p_address uuid, p_origin text,
  p_catalog_hash text, p_address_version timestamptz, p_cart_fingerprint text, p_service_id text, p_service text,
  p_carrier text, p_amount_in_cents integer, p_cost_in_cents integer, p_estimated_days integer,
  p_packages jsonb, p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  shipping jsonb;
  issued private.representative_kit_shipping_checkout_quotes;
begin
  shipping := public.read_representative_kit_grade_shipping(p_actor,p_kit,p_template,p_quantity,p_address,p_origin);
  if shipping is null or shipping ->> 'catalogHash' is distinct from p_catalog_hash
    or (shipping ->> 'addressVersion')::timestamptz is distinct from p_address_version
    or p_expires_at <= clock_timestamp() then
    raise exception 'kit_grade_quote_changed' using errcode = '23514';
  end if;

  insert into private.representative_kit_shipping_checkout_quotes (
    actor_id,variant_id,quantity,address_id,address_updated_at,postal_code,cart_fingerprint,
    service_id,service,carrier,amount_in_cents,cost_in_cents,estimated_days,
    packages,expires_at,origin_postal_code,merchandise_unit_cents,grade_kit_id,grade_template,grade_catalog_hash
  ) values (
    p_actor,(shipping -> 'lines' -> 0 ->> 'variantId')::uuid,p_quantity,p_address,p_address_version,
    shipping ->> 'postalCode',p_cart_fingerprint,p_service_id,p_service,p_carrier,p_amount_in_cents,p_cost_in_cents,
    p_estimated_days,p_packages,least(p_expires_at,clock_timestamp()+interval '30 minutes'),
    p_origin,(shipping ->> 'priceCents')::bigint,p_kit,p_template,p_catalog_hash
  ) returning * into issued;
  return jsonb_build_object('id',issued.id,'shippingInCents',issued.amount_in_cents,
    'amountInCents',issued.merchandise_unit_cents*p_quantity+issued.amount_in_cents,
    'purchaseAvailable',shipping -> 'purchaseAvailable');
end;
$$;
revoke all on function public.confirm_representative_kit_grade_shipping(
  uuid,uuid,text,integer,uuid,text,text,timestamptz,text,text,text,text,integer,integer,integer,jsonb,timestamptz
) from public, anon, authenticated;
grant execute on function public.confirm_representative_kit_grade_shipping(
  uuid,uuid,text,integer,uuid,text,text,timestamptz,text,text,text,text,integer,integer,integer,jsonb,timestamptz
) to service_role;

create function public.reserve_representative_kit_grade_order(
  p_actor uuid,p_kit uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  shipping jsonb;
  quote private.representative_kit_shipping_checkout_quotes;
  placed private.representative_kit_orders;
  delivery public.addresses;
  rule_id uuid;
  component record;
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

  perform 1 from public.kits k where k.id=p_kit and k.active and k.deleted_at is null for share;
  if not found then raise exception 'kit_grade_unavailable' using errcode = '23514'; end if;
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

  for component in
    select (line ->> 'variantId')::uuid as variant, (line ->> 'pairs')::integer*p_quantity as units
    from jsonb_array_elements(shipping -> 'lines') line order by (line ->> 'variantId')::uuid
  loop
    update public.inventory set available_quantity=available_quantity-component.units,
      reserved_quantity=reserved_quantity+component.units,version=version+1,updated_at=now()
      where variant_id=component.variant and available_quantity>=component.units;
    if not found then raise exception 'kit_stock_unavailable' using errcode = '23514'; end if;
  end loop;

  update private.representative_kit_shipping_checkout_quotes set used_at=now() where id=quote.id;
  insert into private.representative_kit_orders (
    actor_id,variant_id,quantity,quote_id,address_id,idempotency_key,rule_version_id,
    sku,product_name,unit_price_cents,shipping_cents,shipping_snapshot,reserved_until,
    grade_kit_id,grade_template,grade_fiscal_fingerprint,grade_lines
  ) values (
    p_actor,quote.variant_id,p_quantity,p_quote,p_address,p_key,rule_id,
    shipping -> 'lines' -> 0 ->> 'sku',shipping ->> 'kitName',quote.merchandise_unit_cents,quote.amount_in_cents,
    jsonb_build_object('provider','melhorenvio','originPostalCode',p_origin,
      'serviceId',quote.service_id,'service',quote.service,'carrier',quote.carrier,'packages',quote.packages,
      'costInCents',quote.cost_in_cents,'estimatedDays',quote.estimated_days,
      'address',jsonb_build_object('state','MG','postalCode',quote.postal_code,'version',delivery.updated_at)),
    least(quote.expires_at,clock_timestamp()+interval '15 minutes'),
    p_kit,p_template,shipping ->> 'fiscalFingerprint',shipping -> 'lines'
  ) returning * into placed;
  return private.representative_kit_order_summary(placed);
end;
$$;
revoke all on function public.reserve_representative_kit_grade_order(uuid,uuid,text,integer,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.reserve_representative_kit_grade_order(uuid,uuid,text,integer,uuid,uuid,uuid,text) to service_role;

create or replace function public.remove_representative_admin_kit(p_kit uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  target public.kits;
begin
  if auth.uid() is null or not private.has_permission('representatives.rules.manage') then
    raise exception 'kit_management_forbidden' using errcode='42501';
  end if;
  select * into target from public.kits where id=p_kit for update;
  if not found then return true; end if;
  if target.deleted_at is not null then return false; end if;
  if target.required_for_activation
    or exists (select 1 from public.kit_orders where kit_id=p_kit)
    or exists (select 1 from public.kit_level_rules where kit_id=p_kit)
    or exists (select 1 from private.representative_kit_shipping_checkout_quotes where grade_kit_id=p_kit)
    or exists (select 1 from private.representative_kit_orders where grade_kit_id=p_kit) then
    update public.kits set active=false,deleted_at=clock_timestamp() where id=p_kit;
    return false;
  end if;
  delete from public.kits where id=p_kit;
  return true;
end;
$$;
