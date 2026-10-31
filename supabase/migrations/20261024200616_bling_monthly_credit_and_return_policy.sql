-- No rate, recipient, provider nature or productive numbering is seeded.
create table private.bling_monthly_credit_rates (
  application_month date not null check (extract(day from application_month)=1),
  revision integer not null check (revision>0),
  reference_month date not null,
  rate numeric(7,4) not null check (rate>0 and rate<=100),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 10 and 200),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  primary key(application_month,revision),
  check(reference_month=(application_month-interval '1 month')::date)
);
alter table private.bling_monthly_credit_rates enable row level security;
alter table private.bling_monthly_credit_rates force row level security;
revoke all on private.bling_monthly_credit_rates from public,anon,authenticated,service_role;

-- Revisions are append-only: correcting an approval keeps the former evidence.
create function private.protect_bling_monthly_credit_history()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'monthly_credit_history_is_immutable' using errcode='23514';
end;
$$;
revoke all on function private.protect_bling_monthly_credit_history() from public,anon,authenticated,service_role;
create trigger protect_bling_monthly_credit_history before update or delete
on private.bling_monthly_credit_rates for each row execute function private.protect_bling_monthly_credit_history();

-- Keep the existing service-only RPC. Rates never come from browser input or
-- the old timeless icms_credit_rate field; an explicit sale date selects a month.
create or replace function public.read_bling_fiscal_rules()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(rule) || jsonb_build_object(
    'natures',(select coalesce(jsonb_agg(jsonb_build_object('final_consumer',n.final_consumer,
      'external_nature_id',n.external_nature_id) order by n.final_consumer),'[]'::jsonb)
      from private.bling_fiscal_natures n where n.scenario=rule.scenario),
    'credit_periods',case when rule.csosn='101' then (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.application_month),'[]'::jsonb)
      from (select distinct on(application_month) * from private.bling_monthly_credit_rates
        order by application_month,revision desc) c) else '[]'::jsonb end
  ) order by scenario),'[]'::jsonb) from private.bling_fiscal_rules rule;
$$;
revoke all on function public.read_bling_fiscal_rules() from public,anon,authenticated;
grant execute on function public.read_bling_fiscal_rules() to service_role;
