begin;
select plan(12);

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
select public.claim_payment_webhook('budget-event-' || n,'lease-payment',repeat('a',64),'payment')
from generate_series(1,8) n;
select is(public.claim_payment_webhook('budget-over-limit','lease-payment',repeat('a',64),'payment'),
  'limited','Distinct signed events share a bounded per-payment provider budget');

select * from finish();
rollback;
