begin;
select plan(14);

select matches(public.claim_payment_webhook('lease-event','lease-payment',repeat('a',64),'payment'),
  '^acquired:[0-9a-f-]{36}$','First event acquires the provider lease');
create temporary table original_lease as select processing_lease_token as token from public.payment_events
where provider='mercadopago' and provider_event_id='lease-event';
select is(public.claim_payment_webhook('lease-event','lease-payment',repeat('a',64),'payment'),
  'busy','Overlapping delivery cannot acquire a second lease');
select is(public.claim_payment_webhook('lease-event','lease-payment',repeat('b',64),'payment'),
  'hash_conflict','A reused event ID cannot replace the payload');
-- Payment finalization alone must not skip refunds on a subsequent retry.
update public.payment_events set processing_status='processed',processing_lease_until=now()-interval '1 second'
where provider='mercadopago' and provider_event_id='lease-event';
select matches(public.claim_payment_webhook('lease-event','lease-payment',repeat('a',64),'payment'),
  '^acquired:[0-9a-f-]{36}$','Finalized payment remains retryable until refunds are reconciled');
select is(public.finish_payment_webhook('lease-event',(select token from original_lease),true,null),false,
  'An expired worker cannot acknowledge a newer lease');
select is(public.finish_payment_webhook('lease-event',(select processing_lease_token from public.payment_events
  where provider='mercadopago' and provider_event_id='lease-event'),true,null),true,
  'Only the current worker can acknowledge completed reconciliation');
select is(public.claim_payment_webhook('lease-event','lease-payment',repeat('a',64),'payment'),
  'duplicate','Only complete processing acknowledges duplicates');
select is(has_function_privilege('authenticated','public.claim_payment_webhook(text,text,text,text)','execute'),
  false,'Customers and internal browser clients cannot claim provider events');
select is(has_function_privilege('anon','public.claim_payment_webhook(text,text,text,text)','execute'),
  false,'Anonymous clients cannot consume provider budgets');
select is(has_function_privilege('authenticated','public.finish_payment_webhook(text,uuid,boolean,text)','execute'),
  false,'Browser clients cannot finish financial events');
select is(has_function_privilege('anon','public.finish_payment_webhook(text,uuid,boolean,text)','execute'),
  false,'Anonymous clients cannot acknowledge provider events');
-- Use a fresh payment and a complete fixed window. The earlier lease assertions
-- may straddle a minute boundary; they must not supply part of this budget.
create temporary table bounded_budget_result(first_ten_acquired boolean,over_limit text,payment_id text);
do $$declare bucket timestamptz; payment text; result text; all_acquired boolean; attempt integer; n integer;
begin
  for attempt in 1..3 loop
    payment:='budget-payment-'||gen_random_uuid()::text;
    bucket:=date_trunc('minute',clock_timestamp());all_acquired:=true;
    for n in 1..10 loop
      result:=public.claim_payment_webhook('budget-'||payment||'-'||n,payment,repeat('a',64),'payment');
      all_acquired:=all_acquired and result ~ '^acquired:[0-9a-f-]{36}$';
    end loop;
    result:=public.claim_payment_webhook('budget-over-'||payment,payment,repeat('a',64),'payment');
    if date_trunc('minute',clock_timestamp())=bucket then
      insert into bounded_budget_result values(all_acquired,result,payment);return;
    end if;
  end loop;
  raise exception 'Could not observe one complete provider-budget window';
end;$$;
select ok((select first_ten_acquired from bounded_budget_result),'Ten distinct events within one window acquire leases');
select is((select over_limit from bounded_budget_result),'limited','Eleventh distinct event in the same window is limited');
update private.payment_webhook_budgets set window_started_at=clock_timestamp()-interval '2 minutes'
where payment_hash=encode(sha256(convert_to((select payment_id from bounded_budget_result),'UTF8')),'hex');
select matches(public.claim_payment_webhook('budget-next-window',(select payment_id from bounded_budget_result),repeat('a',64),'payment'),
  '^acquired:[0-9a-f-]{36}$','A later window renews the bounded provider budget');

select * from finish();
rollback;
