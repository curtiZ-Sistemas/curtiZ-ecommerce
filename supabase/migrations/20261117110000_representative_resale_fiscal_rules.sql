-- Private, append-only fiscal rule evidence for the future resale integration.
-- No rules, approvals, or production-enabling flags are seeded by this migration.
create table private.representative_resale_fiscal_rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_key uuid not null,
  version integer not null check (version > 0),
  issuer_reference text not null check (length(btrim(issuer_reference)) between 1 and 120),
  product_fingerprint text not null check (product_fingerprint ~ '^[a-f0-9]{64}$'),
  origin_state text not null check (origin_state in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  destination_state text not null check (destination_state in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  person_type text not null check (person_type in ('individual','business')),
  icms_status text not null check (icms_status in ('taxpayer','registration_exempt','non_taxpayer')),
  final_consumer boolean not null,
  purpose text not null check (purpose = 'resale'),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  fiscal_parameters jsonb not null check (jsonb_typeof(fiscal_parameters) = 'object' and fiscal_parameters <> '{}'::jsonb),
  created_at timestamptz not null default now(),
  unique (rule_key, version),
  check (valid_from < valid_until)
);

create table private.representative_resale_fiscal_rule_approvals (
  rule_version_id uuid primary key references private.representative_resale_fiscal_rule_versions(id),
  approver_reference text not null check (length(btrim(approver_reference)) between 3 and 200),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 10 and 500),
  approved_at timestamptz not null default now()
);

create table private.representative_resale_fiscal_rule_revocations (
  rule_version_id uuid primary key references private.representative_resale_fiscal_rule_approvals(rule_version_id),
  reason text not null check (length(btrim(reason)) between 10 and 500),
  revoked_at timestamptz not null default now()
);

alter table private.representative_resale_fiscal_rule_versions enable row level security;
alter table private.representative_resale_fiscal_rule_versions force row level security;
alter table private.representative_resale_fiscal_rule_approvals enable row level security;
alter table private.representative_resale_fiscal_rule_approvals force row level security;
alter table private.representative_resale_fiscal_rule_revocations enable row level security;
alter table private.representative_resale_fiscal_rule_revocations force row level security;
revoke all on private.representative_resale_fiscal_rule_versions,
  private.representative_resale_fiscal_rule_approvals,
  private.representative_resale_fiscal_rule_revocations from public, anon, authenticated, service_role;

create function private.protect_resale_fiscal_rule_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'resale_fiscal_history_is_append_only' using errcode = '23514';
end;
$$;
revoke all on function private.protect_resale_fiscal_rule_history() from public, anon, authenticated, service_role;
create trigger protect_resale_fiscal_rule_versions before update or delete on private.representative_resale_fiscal_rule_versions
  for each row execute function private.protect_resale_fiscal_rule_history();
create trigger protect_resale_fiscal_rule_approvals before update or delete on private.representative_resale_fiscal_rule_approvals
  for each row execute function private.protect_resale_fiscal_rule_history();
create trigger protect_resale_fiscal_rule_revocations before update or delete on private.representative_resale_fiscal_rule_revocations
  for each row execute function private.protect_resale_fiscal_rule_history();

-- This is a lookup only: a match does not authorize checkout, charging, NF-e,
-- or shipping. The future server-side integration must validate the snapshot,
-- recipient, approval evidence, and all release gates before using any rule.
-- A missing or ambiguous rule fails closed; no caller controls the lookup time.
create function public.find_representative_resale_fiscal_rule_candidate(
  p_issuer_reference text, p_product_fingerprint text, p_origin_state text,
  p_destination_state text, p_person_type text, p_icms_status text,
  p_final_consumer boolean, p_purpose text
) returns jsonb language sql stable security definer set search_path = '' as $$
  with candidates as (
    select r.id, r.rule_key, r.version, r.valid_from, r.valid_until, r.fiscal_parameters,
      a.approver_reference, a.evidence_reference, a.approved_at
    from private.representative_resale_fiscal_rule_versions r
    join private.representative_resale_fiscal_rule_approvals a on a.rule_version_id = r.id
    left join private.representative_resale_fiscal_rule_revocations x on x.rule_version_id = r.id
    where r.issuer_reference = p_issuer_reference and r.product_fingerprint = p_product_fingerprint
      and r.origin_state = p_origin_state and r.destination_state = p_destination_state
      and r.person_type = p_person_type and r.icms_status = p_icms_status
      and r.final_consumer = p_final_consumer and r.purpose = p_purpose
      and r.valid_from <= statement_timestamp() and statement_timestamp() < r.valid_until
      and a.approved_at <= statement_timestamp() and x.rule_version_id is null
  )
  select case when count(*) = 1 then (jsonb_agg(to_jsonb(candidates)) -> 0) else null end from candidates;
$$;
revoke all on function public.find_representative_resale_fiscal_rule_candidate(text,text,text,text,text,text,boolean,text)
  from public, anon, authenticated;
grant execute on function public.find_representative_resale_fiscal_rule_candidate(text,text,text,text,text,text,boolean,text)
  to service_role;

-- A server-derived identifier for the current kit fiscal composition. This is
-- not a fiscal approval and must not be accepted from a browser as evidence.
-- Missing, inactive, stale or incomplete catalog data fails closed.
create function public.read_representative_resale_product_fingerprint(p_variant_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  with kit as (
    select v.id, private.bling_kit_source_hash(v.id) as source_hash, m.pairs_per_sku,
      to_jsonb(m) as metadata
    from public.product_variants v
    join public.products p on p.id = v.product_id
    join private.bling_catalog_metadata m on m.product_id = p.id
    where v.id = p_variant_id and v.active and p.status = 'active' and m.pairs_per_sku > 1
  ), components as (
    select c.kit_variant_id, jsonb_agg(to_jsonb(c) order by c.position) as snapshot,
      sum(c.quantity_pairs) as pairs, bool_and(c.source_hash = kit.source_hash) as source_current
    from private.bling_kit_fiscal_components c join kit on kit.id = c.kit_variant_id
    group by c.kit_variant_id
  )
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    jsonb_build_object('version',1,'sourceHash',kit.source_hash,'metadata',kit.metadata,
      'components',components.snapshot)::text,'UTF8')),'hex')
  from kit join components on components.kit_variant_id = kit.id
  where kit.source_hash is not null and components.source_current is true and components.pairs = kit.pairs_per_sku;
$$;
revoke all on function public.read_representative_resale_product_fingerprint(uuid) from public, anon, authenticated;
grant execute on function public.read_representative_resale_product_fingerprint(uuid) to service_role;
