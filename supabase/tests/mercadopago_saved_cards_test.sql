begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('ce000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cards-a@test.local','{}','{"full_name":"Cards A"}',now(),now()),
 ('ce000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cards-b@test.local','{}','{"full_name":"Cards B"}',now(),now());
update public.profiles set status = 'active' where id in ('ce000000-0000-4000-8000-000000000001','ce000000-0000-4000-8000-000000000002');
insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,subtotal,grand_total,shipping_address_snapshot,payment_status,status)
values('ce100000-0000-4000-8000-000000000001','ce000000-0000-4000-8000-000000000001','cards-a@test.local','Cards A',50,50,'{}','approved','payment_approved');
select ok(not has_function_privilege('authenticated','public.claim_mercadopago_customer(uuid,text)','execute'),'customer creation is server-only');
select ok(not has_function_privilege('anon','public.claim_mercadopago_card_save(uuid,uuid,uuid,uuid)','execute'),'anonymous cannot associate cards');
select ok(not has_table_privilege('authenticated','public.payment_provider_customers','INSERT'),'browser cannot select its own provider identity');
select ok((public.claim_mercadopago_customer('ce000000-0000-4000-8000-000000000001','test')->>'claimed')::boolean,'first request owns the create claim');
select ok(not (public.claim_mercadopago_customer('ce000000-0000-4000-8000-000000000001','test')->>'claimed')::boolean,'retry cannot create another Customer');
select is((select count(*) from public.payment_provider_customers where user_id='ce000000-0000-4000-8000-000000000001'),1::bigint,'one association per user/provider/mode');
select public.finish_mercadopago_customer(id,creation_key,'customer-test-owned') from public.payment_provider_customers where user_id='ce000000-0000-4000-8000-000000000001';
create function pg_temp.claim_save(actor uuid, key uuid) returns jsonb language sql as $$
  select public.claim_mercadopago_card_save(actor,
    (select id from public.payment_provider_customers where user_id='ce000000-0000-4000-8000-000000000001'),
    'ce100000-0000-4000-8000-000000000001', key);
$$;
select throws_ok($$select pg_temp.claim_save('ce000000-0000-4000-8000-000000000002','ce200000-0000-4000-8000-000000000001')$$,'42501','customer_not_owned','B cannot save on A Customer');
select ok((pg_temp.claim_save('ce000000-0000-4000-8000-000000000001','ce200000-0000-4000-8000-000000000001')->>'claimed')::boolean,'explicit operation is claimed once');
select ok(not (pg_temp.claim_save('ce000000-0000-4000-8000-000000000001','ce200000-0000-4000-8000-000000000001')->>'claimed')::boolean,'same operation cannot reissue provider POST');
select throws_ok($$select pg_temp.claim_save('ce000000-0000-4000-8000-000000000001','ce200000-0000-4000-8000-000000000002')$$,'P0001','card_save_in_progress','uncertain active save blocks different operation');
select public.finish_mercadopago_card_save('ce200000-0000-4000-8000-000000000001','card-reference',false);
select is(pg_temp.claim_save('ce000000-0000-4000-8000-000000000001','ce200000-0000-4000-8000-000000000001')->>'state','succeeded','completed operation replays without token');
select public.audit_mercadopago_card_delete('ce000000-0000-4000-8000-000000000001',id,'card-reference','ce300000-0000-4000-8000-000000000001')
  from public.payment_provider_customers where user_id='ce000000-0000-4000-8000-000000000001';
select is((select count(*) from public.audit_logs where request_id='ce300000-0000-4000-8000-000000000001' and action='saved_card.delete'),1::bigint,'deletion audit records provider reference');
select set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.payment_provider_customers where user_id='ce000000-0000-4000-8000-000000000001'),0::bigint,'RLS hides A Customer from B');
select is((select count(*) from public.payment_provider_card_operations),0::bigint,'RLS hides A card operations from B');
reset role;
select set_config('request.jwt.claims','{"sub":"ce000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.payment_provider_card_operations),1::bigint,'RLS allows only own safe operation state');
reset role;
select * from finish();
rollback;
