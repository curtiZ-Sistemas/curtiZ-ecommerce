-- A taxpayer can also be a final consumer. Bind the provider nature to both
-- dimensions; a single scenario ID must never silently classify the recipient.
create table private.bling_fiscal_natures (
  scenario text not null references private.bling_fiscal_rules(scenario),
  final_consumer boolean not null,
  external_nature_id bigint not null unique check (external_nature_id>0),
  evidence_reference text not null check (length(evidence_reference) between 10 and 200),
  updated_at timestamptz not null default now(),
  primary key(scenario,final_consumer)
);
alter table private.bling_fiscal_natures enable row level security;
alter table private.bling_fiscal_natures force row level security;
revoke all on private.bling_fiscal_natures from public,anon,authenticated;
create or replace function public.read_bling_fiscal_rules()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(rule) || jsonb_build_object('natures',(
    select coalesce(jsonb_agg(jsonb_build_object('final_consumer',n.final_consumer,'external_nature_id',n.external_nature_id)
      order by n.final_consumer),'[]'::jsonb) from private.bling_fiscal_natures n where n.scenario=rule.scenario
  )) order by scenario),'[]'::jsonb) from private.bling_fiscal_rules rule;
$$;
revoke all on function public.read_bling_fiscal_rules() from public,anon,authenticated;
grant execute on function public.read_bling_fiscal_rules() to service_role;
