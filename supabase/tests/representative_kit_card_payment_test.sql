begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Structure and permissions of the card payment for commercial kit orders. The order flow itself
-- (claim, refusal and retry) shares its fixtures with the Pix tests and is covered by the
-- application tests with a mocked provider and by tests/db-static.
select has_column('private','representative_kit_orders','payment_method','orders remember the payment method');
select has_column('private','representative_kit_orders','card_attempt_id','orders remember the card attempt');
select col_not_null('private','representative_kit_orders','card_rejected_payment_ids','refused attempts are always a list');
select col_default_is('private','representative_kit_orders','card_rejected_payment_ids','{}'::text[],'no refused attempt by default');

select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
  from pg_proc p where p.oid='public.claim_representative_kit_card(uuid,uuid,boolean)'::regprocedure),
  'the card claim is security definer with an empty search_path');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
  from pg_proc p where p.oid='public.release_representative_kit_card_claim(uuid,uuid,uuid)'::regprocedure),
  'releasing a card claim is security definer with an empty search_path');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
  from pg_proc p where p.oid='public.expire_representative_kit_card_claim(uuid)'::regprocedure),
  'expiring a card claim is security definer with an empty search_path');

select ok(not has_function_privilege('authenticated','public.claim_representative_kit_card(uuid,uuid,boolean)','execute')
  and not has_function_privilege('anon','public.claim_representative_kit_card(uuid,uuid,boolean)','execute')
  and has_function_privilege('service_role','public.claim_representative_kit_card(uuid,uuid,boolean)','execute'),
  'only the service role claims a card payment');
select ok(not has_function_privilege('authenticated','public.release_representative_kit_card_claim(uuid,uuid,uuid)','execute')
  and has_function_privilege('service_role','public.release_representative_kit_card_claim(uuid,uuid,uuid)','execute'),
  'only the service role returns a card claim');
select ok(not has_function_privilege('authenticated','public.expire_representative_kit_card_claim(uuid)','execute')
  and has_function_privilege('service_role','public.expire_representative_kit_card_claim(uuid)','execute'),
  'only the service role expires a card claim');
select ok(not has_function_privilege('authenticated','public.settle_representative_kit_payment(uuid,text,text,bigint,text,text,timestamptz,jsonb)','execute')
  and not has_function_privilege('authenticated','public.claim_representative_kit_pix(uuid,uuid,boolean)','execute'),
  'buyers still cannot confirm or claim a payment themselves');
select ok(not has_table_privilege('service_role','private.representative_kit_orders','update'),
  'the service API still cannot mutate the aggregate directly');

select * from finish();
rollback;
