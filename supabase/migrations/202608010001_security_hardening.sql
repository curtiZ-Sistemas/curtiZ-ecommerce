-- Security hardening: RLS parity and privacy-preserving authentication rate limits.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'representative_applications','representative_application_documents','representative_application_reviews',
    'representative_levels','representative_level_rules','representatives','representative_status_history',
    'representative_level_history','referral_relationships','representative_network_closure',
    'qualification_rules','representative_qualifications','representative_goals','kits','kit_items',
    'kit_level_rules','kit_orders','kit_order_items','representative_inventory',
    'representative_inventory_movements','representative_sales','representative_sale_items',
    'commission_rules','commission_entries','commission_adjustments','commission_closings',
    'commission_closing_entries','commission_payments','representative_documents',
    'representative_contracts','representative_trainings','representative_notifications',
    'creative_categories','creative_campaigns','creative_assets','creative_approvals',
    'creative_favorites','creative_usage_events','creative_packages'
  ]
  loop
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end
$$;

create table private.auth_rate_limits (
  scope text not null check (scope in ('login', 'signup')),
  key_hash text not null check (length(key_hash) = 64),
  window_started_at timestamptz not null,
  attempts integer not null default 1 check (attempts > 0),
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash, window_started_at)
);

create index auth_rate_limits_expiry_idx on private.auth_rate_limits(window_started_at);

create or replace function public.enforce_auth_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  bucket timestamptz;
  current_attempts integer;
begin
  if p_scope not in ('login', 'signup')
     or p_key_hash !~ '^[a-f0-9]{64}$'
     or p_limit not between 1 and 100
     or p_window_seconds not between 60 and 86400 then
    raise exception 'invalid rate limit parameters';
  end if;

  bucket := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into private.auth_rate_limits(scope, key_hash, window_started_at, attempts, updated_at)
  values (p_scope, p_key_hash, bucket, 1, clock_timestamp())
  on conflict (scope, key_hash, window_started_at)
  do update set
    attempts = private.auth_rate_limits.attempts + 1,
    updated_at = clock_timestamp()
  returning attempts into current_attempts;

  return current_attempts <= p_limit;
end;
$$;

revoke all on function public.enforce_auth_rate_limit(text, text, integer, integer) from public;
grant execute on function public.enforce_auth_rate_limit(text, text, integer, integer)
  to anon, authenticated;

