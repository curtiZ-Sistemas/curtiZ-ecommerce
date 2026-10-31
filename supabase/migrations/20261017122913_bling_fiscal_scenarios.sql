-- Private, reviewed configuration. No fiscal choices or company identifiers are seeded.
create table private.bling_fiscal_rules (
  scenario text primary key check (scenario in ('sale_in_state','sale_interstate_taxpayer','sale_interstate_non_taxpayer','return_in_state','return_interstate')),
  issuer_state char(2) not null check (issuer_state ~ '^[A-Z]{2}$'),
  cfop char(4) not null check (cfop ~ '^[0-9]{4}$'),
  csosn char(3) not null check (csosn ~ '^[0-9]{3}$'),
  icms_rate numeric(7,4) not null check (icms_rate between 0 and 100),
  document_model integer not null default 55 check (document_model=55),
  series integer not null check (series between 1 and 999),
  external_nature_id bigint check (external_nature_id>0),
  evidence_reference text not null check (length(evidence_reference) between 10 and 200),
  updated_at timestamptz not null default now()
);
alter table private.bling_fiscal_rules enable row level security;
alter table private.bling_fiscal_rules force row level security;
revoke all on private.bling_fiscal_rules from public,anon,authenticated;
create or replace function public.read_bling_fiscal_rules()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(rule) order by scenario),'[]'::jsonb) from private.bling_fiscal_rules rule;
$$;
revoke all on function public.read_bling_fiscal_rules() from public,anon,authenticated;
grant execute on function public.read_bling_fiscal_rules() to service_role;

-- Approval is entered privately after reviewing the exact mirror. No browser grant.
create table private.bling_fiscal_mirror_approvals (
  order_id uuid primary key references public.orders(id),
  mirror_hash text not null check (mirror_hash ~ '^[a-f0-9]{64}$'),
  icms_taxpayer boolean not null,
  final_consumer boolean not null,
  evidence_reference text not null check (length(evidence_reference) between 10 and 200),
  approved_at timestamptz not null default now()
);
alter table private.bling_fiscal_mirror_approvals enable row level security;
alter table private.bling_fiscal_mirror_approvals force row level security;
revoke all on private.bling_fiscal_mirror_approvals from public,anon,authenticated;
create or replace function public.read_bling_fiscal_mirror_approval(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(approval) from private.bling_fiscal_mirror_approvals approval where order_id=p_order_id;
$$;
revoke all on function public.read_bling_fiscal_mirror_approval(uuid) from public,anon,authenticated;
grant execute on function public.read_bling_fiscal_mirror_approval(uuid) to service_role;
