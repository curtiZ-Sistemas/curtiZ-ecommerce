-- Isolated fixtures; the complete test rolls back. Never run as a cleanup in production.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
select has_function('public','purge_expired_intelligence_data',array['integer']);
select ok(not has_function_privilege('anon','public.purge_expired_intelligence_data(integer)','EXECUTE'),'Anonymous visitors cannot purge analytics');
select ok(not has_function_privilege('authenticated','public.purge_expired_intelligence_data(integer)','EXECUTE'),'Customers and panel sessions cannot call the maintenance RPC');
select ok(has_function_privilege('service_role','public.purge_expired_intelligence_data(integer)','EXECUTE'),'Only the server role receives execution');
update public.system_settings set value='30'::jsonb where key='intelligence_event_retention_days';
insert into auth.users(id,email,raw_user_meta_data)
values ('ab110000-0000-4000-8000-000000000030','retention-order@example.invalid','{"full_name":"Retention fixture"}');
insert into public.orders(id,public_code,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot)
values ('ab110000-0000-4000-8000-000000000031','RETENTION-CI-ORDER','ab110000-0000-4000-8000-000000000030','retention-order@example.invalid','Retention fixture','pending_payment','pending',1,1,'{}');
insert into public.marketing_events(id,anonymous_session_id,event_type,order_id,occurred_at)
values ('ab110000-0000-4000-8000-000000000004','ab110000-0000-4000-8000-000000000010','page_view','ab110000-0000-4000-8000-000000000031',now()-interval '31 days');
insert into public.marketing_events(id,anonymous_session_id,event_type,occurred_at) values
 ('ab110000-0000-4000-8000-000000000001','ab110000-0000-4000-8000-000000000010','page_view',now()-interval '31 days'),
 ('ab110000-0000-4000-8000-000000000002','ab110000-0000-4000-8000-000000000010','page_view',now()-interval '30 days'),
 ('ab110000-0000-4000-8000-000000000003','ab110000-0000-4000-8000-000000000010','page_view',now()-interval '1 day');
insert into public.session_interest_profiles(session_id,expires_at) values
 ('ab110000-0000-4000-8000-000000000011',now()-interval '1 minute'),
 ('ab110000-0000-4000-8000-000000000012',now()+interval '1 day');
insert into private.intelligence_rate_buckets(session_id,window_start,event_count) values
 ('ab110000-0000-4000-8000-000000000013',now()-interval '2 days',1),
 ('ab110000-0000-4000-8000-000000000014',now(),1);
set local role service_role;
select lives_ok($$select public.purge_expired_intelligence_data(1000)$$,'The server can execute the cleanup');
reset role;
select is((select count(*) from public.marketing_events where id='ab110000-0000-4000-8000-000000000001'),0::bigint,'Expired individual event is removed');
select is((select count(*) from public.marketing_events where id='ab110000-0000-4000-8000-000000000002'),1::bigint,'The retention boundary is preserved');
select is((select count(*) from public.marketing_events where id='ab110000-0000-4000-8000-000000000003'),1::bigint,'A current event is preserved');
select is((select count(*) from public.marketing_events where id='ab110000-0000-4000-8000-000000000004'),1::bigint,'An order-linked commercial event is preserved despite its age');
select is((select count(*) from public.session_interest_profiles where session_id='ab110000-0000-4000-8000-000000000011'),0::bigint,'Expired interest profile is removed');
select is((select count(*) from public.session_interest_profiles where session_id='ab110000-0000-4000-8000-000000000012'),1::bigint,'Current interest profile is preserved');
select is((select count(*) from private.intelligence_rate_buckets where session_id='ab110000-0000-4000-8000-000000000013'),0::bigint,'Expired rate bucket is removed');
select is((select count(*) from private.intelligence_rate_buckets where session_id='ab110000-0000-4000-8000-000000000014'),1::bigint,'Current rate bucket is preserved');
insert into public.marketing_events(id,anonymous_session_id,event_type,occurred_at) values
 ('ab110000-0000-4000-8000-000000000021','ab110000-0000-4000-8000-000000000010','page_view',now()-interval '200 years'),
 ('ab110000-0000-4000-8000-000000000022','ab110000-0000-4000-8000-000000000010','page_view',now()-interval '200 years');
select public.purge_expired_intelligence_data(1);
select is((select count(*) from public.marketing_events where id in ('ab110000-0000-4000-8000-000000000021','ab110000-0000-4000-8000-000000000022')),1::bigint,'A batch of one does not delete both expired fixtures');
select public.purge_expired_intelligence_data(1);
select is((select count(*) from public.marketing_events where id in ('ab110000-0000-4000-8000-000000000021','ab110000-0000-4000-8000-000000000022')),0::bigint,'A later execution safely completes the expired batch');
select * from finish();
rollback;
