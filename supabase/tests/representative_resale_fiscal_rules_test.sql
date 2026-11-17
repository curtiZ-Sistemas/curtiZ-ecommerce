begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon', 'public.find_representative_resale_fiscal_rule_candidate(text,text,text,text,text,text,boolean,text)', 'execute'), 'anonymous role cannot look up fiscal rules');
select ok(not has_function_privilege('authenticated', 'public.find_representative_resale_fiscal_rule_candidate(text,text,text,text,text,text,boolean,text)', 'execute'), 'authenticated clients cannot look up private rules');
select ok(has_function_privilege('service_role', 'public.find_representative_resale_fiscal_rule_candidate(text,text,text,text,text,text,boolean,text)', 'execute'), 'server can look up a candidate');
select ok(not has_table_privilege('service_role', 'private.representative_resale_fiscal_rule_approvals', 'insert'), 'service role cannot grant approvals directly');

insert into private.representative_resale_fiscal_rule_versions
  (id,rule_key,version,issuer_reference,product_fingerprint,origin_state,destination_state,person_type,icms_status,final_consumer,purpose,valid_from,valid_until,fiscal_parameters)
values
  ('aa100000-0000-4000-8000-000000000001','aa200000-0000-4000-8000-000000000001',1,'synthetic-issuer',repeat('a',64),'MG','SP','business','taxpayer',false,'resale',now()-interval '1 day',now()+interval '1 day','{"fixture":true}'::jsonb),
  ('aa100000-0000-4000-8000-000000000002','aa200000-0000-4000-8000-000000000001',2,'synthetic-issuer',repeat('a',64),'MG','SP','business','taxpayer',false,'resale',now()-interval '1 day',now()+interval '1 day','{"fixture":true}'::jsonb),
  ('aa100000-0000-4000-8000-000000000003','aa200000-0000-4000-8000-000000000002',1,'synthetic-issuer',repeat('b',64),'MG','SP','business','taxpayer',false,'resale',now()-interval '2 days',now()-interval '1 day','{"fixture":true}'::jsonb);

select is(public.find_representative_resale_fiscal_rule_candidate('synthetic-issuer',repeat('a',64),'MG','SP','business','taxpayer',false,'resale'),null::jsonb,'unapproved rule is not returned');
insert into private.representative_resale_fiscal_rule_approvals(rule_version_id,approver_reference,evidence_reference) values
  ('aa100000-0000-4000-8000-000000000001','synthetic-reviewer','synthetic-evidence-1'),
  ('aa100000-0000-4000-8000-000000000003','synthetic-reviewer','synthetic-evidence-3');
select is(public.find_representative_resale_fiscal_rule_candidate('synthetic-issuer',repeat('a',64),'MG','SP','business','taxpayer',false,'resale')->>'id','aa100000-0000-4000-8000-000000000001','one approved matching version is a candidate');
select is(public.find_representative_resale_fiscal_rule_candidate('synthetic-issuer',repeat('a',64),'MG','SP','individual','taxpayer',false,'resale'),null::jsonb,'different recipient does not match');
select is(public.find_representative_resale_fiscal_rule_candidate('synthetic-issuer',repeat('a',64),'MG','SP','business','taxpayer',null,'resale'),null::jsonb,'missing consumer status fails closed');
select is(public.find_representative_resale_fiscal_rule_candidate('synthetic-issuer',repeat('b',64),'MG','SP','business','taxpayer',false,'resale'),null::jsonb,'expired version is not returned');
select throws_ok($$update private.representative_resale_fiscal_rule_versions set fiscal_parameters='{"fixture":false}'::jsonb where id='aa100000-0000-4000-8000-000000000001'$$,'23514','resale_fiscal_history_is_append_only','approved rule contents cannot be edited');
select throws_ok($$delete from private.representative_resale_fiscal_rule_approvals where rule_version_id='aa100000-0000-4000-8000-000000000001'$$,'23514','resale_fiscal_history_is_append_only','approval cannot be silently removed');

insert into private.representative_resale_fiscal_rule_approvals(rule_version_id,approver_reference,evidence_reference)
values ('aa100000-0000-4000-8000-000000000002','synthetic-reviewer','synthetic-evidence-2');
select is(public.find_representative_resale_fiscal_rule_candidate('synthetic-issuer',repeat('a',64),'MG','SP','business','taxpayer',false,'resale'),null::jsonb,'overlapping approved versions fail closed');
insert into private.representative_resale_fiscal_rule_revocations(rule_version_id,reason)
values ('aa100000-0000-4000-8000-000000000002','synthetic revocation reason');
select is(public.find_representative_resale_fiscal_rule_candidate('synthetic-issuer',repeat('a',64),'MG','SP','business','taxpayer',false,'resale')->>'id','aa100000-0000-4000-8000-000000000001','revocation excludes only that version');
select throws_ok($$delete from private.representative_resale_fiscal_rule_revocations where rule_version_id='aa100000-0000-4000-8000-000000000002'$$,'23514','resale_fiscal_history_is_append_only','revocation cannot be silently removed');

select * from finish();
rollback;

