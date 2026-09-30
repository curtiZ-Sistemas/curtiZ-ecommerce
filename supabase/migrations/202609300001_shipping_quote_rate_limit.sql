-- Give shipping quotations an independent budget without changing checkout/coupon limits.
alter table private.auth_rate_limits drop constraint if exists auth_rate_limits_scope_check;
alter table private.auth_rate_limits add constraint auth_rate_limits_scope_check check (
  scope in ('login','signup','password_reset','privacy_request',
    'mfa_read','mfa_enroll','mfa_verify','support_read','support_write','support_upload','support_download',
    'checkout_quote','shipping_quote','payment_attempt','payment_reconcile','account_delete','order_cancel',
    'return_request','admin_mutation','customer_upload','customer_write','public_api')
);

create or replace function public.consume_private_api_rate_limit(p_scope text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  maximum integer;
  seconds integer;
  bucket timestamptz;
  attempts integer;
  identity_hash text;
begin
  if actor is null or not private.is_active_user() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  case p_scope
    when 'mfa_read' then maximum := 60; seconds := 60;
    when 'mfa_enroll' then maximum := 5; seconds := 900;
    when 'mfa_verify' then maximum := 10; seconds := 900;
    when 'support_read' then maximum := 120; seconds := 60;
    when 'support_write' then maximum := 30; seconds := 60;
    when 'support_upload' then maximum := 10; seconds := 900;
    when 'support_download' then maximum := 60; seconds := 60;
    when 'checkout_quote' then maximum := 30; seconds := 60;
    when 'shipping_quote' then maximum := 30; seconds := 60;
    when 'payment_attempt' then maximum := 10; seconds := 900;
    when 'payment_reconcile' then maximum := 5; seconds := 900;
    when 'account_delete' then maximum := 5; seconds := 900;
    when 'order_cancel' then maximum := 5; seconds := 600;
    when 'return_request' then maximum := 10; seconds := 3600;
    when 'customer_upload' then maximum := 10; seconds := 900;
    when 'customer_write' then maximum := 30; seconds := 60;
    when 'admin_mutation' then
      if private.current_app_role() in ('customer','representative') then
        raise exception 'Access denied' using errcode = '42501';
      end if;
      maximum := 120; seconds := 60;
    else raise exception 'Invalid operation' using errcode = '22023';
  end case;
  identity_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(actor::text, 'UTF8')), 'hex');
  bucket := pg_catalog.to_timestamp(pg_catalog.floor(extract(epoch from pg_catalog.clock_timestamp()) / seconds) * seconds);
  insert into private.auth_rate_limits as limits(scope,key_hash,window_started_at,attempts,updated_at)
    values(p_scope,identity_hash,bucket,1,pg_catalog.clock_timestamp())
    on conflict (scope,key_hash,window_started_at) do update
      set attempts = limits.attempts + 1, updated_at = pg_catalog.clock_timestamp()
    returning limits.attempts into attempts;
  return attempts <= maximum;
end;
$$;

revoke all on function public.consume_private_api_rate_limit(text) from public, anon;
grant execute on function public.consume_private_api_rate_limit(text) to authenticated;

notify pgrst, 'reload schema';
