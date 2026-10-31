begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_table_privilege('authenticated','private.bling_fiscal_rules','select'),'Scenario configuration is private');
select ok(not has_function_privilege('authenticated','public.read_bling_fiscal_rules()','execute'),'Scenarios are backend-only');
select ok(not has_table_privilege('authenticated','private.bling_fiscal_mirror_approvals','insert'),'Clients cannot approve accountant mirrors');
select ok(not has_function_privilege('anon','public.read_bling_fiscal_mirror_approval(uuid)','execute'),'Anonymous callers cannot read approvals');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.bling_fiscal_rules'::regclass),'Scenario table has forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.bling_fiscal_mirror_approvals'::regclass),'Approval table has forced RLS');
select is(public.read_bling_fiscal_rules(),'[]'::jsonb,'Migration never guesses fiscal IDs or rules');
select is(public.read_bling_fiscal_mirror_approval('bc900000-0000-4000-8000-000000000001'),null::jsonb,'Unapproved order cannot pass fiscal preflight');
insert into private.bling_fiscal_rules(scenario,issuer_state,cfop,csosn,icms_rate,series,evidence_reference)
values('sale_in_state','MG','5102','102',0,2,'Isolated test approval');
select is(jsonb_array_length(public.read_bling_fiscal_rules()),1,'Entered private rule can be read by backend');
select is(public.read_bling_fiscal_rules()->0->>'external_nature_id',null::text,'Rule stays unlinked until an actual external nature is confirmed');
select * from finish();
rollback;
