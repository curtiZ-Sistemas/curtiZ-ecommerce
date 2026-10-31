begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_table_privilege('authenticated','private.bling_fiscal_natures','select'),'Recipient nature bindings are private');
select ok(not has_table_privilege('anon','private.bling_fiscal_natures','insert'),'Anonymous callers cannot approve provider bindings');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.bling_fiscal_natures'::regclass),'Recipient bindings have forced RLS');
select ok(not has_function_privilege('authenticated','public.read_bling_fiscal_rules()','execute'),'Merged fiscal metadata remains backend-only');
insert into private.bling_fiscal_rules(scenario,issuer_state,cfop,csosn,icms_rate,series,evidence_reference)
values('sale_in_state','MG','5102','102',0,2,'Isolated test approval');
select is(public.read_bling_fiscal_rules()->0->'natures','[]'::jsonb,'No provider IDs are guessed');
insert into private.bling_fiscal_natures(scenario,final_consumer,external_nature_id,evidence_reference)
values('sale_in_state',false,1001,'Isolated nonfinal review'),('sale_in_state',true,1002,'Isolated final review');
select is(jsonb_array_length(public.read_bling_fiscal_rules()->0->'natures'),2,'Both recipient contexts can use the same CFOP without sharing an incorrect nature');
select is(public.read_bling_fiscal_rules()->0->'natures'->0->>'final_consumer','false','Nonfinal binding is explicit');
select is(public.read_bling_fiscal_rules()->0->'natures'->1->>'external_nature_id','1002','Final binding preserves its own verified provider ID');
select * from finish();
rollback;
