begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid='private.bling_monthly_credit_rates'::regclass),'Monthly credit retains forced RLS');
select ok(not has_table_privilege('authenticated','private.bling_monthly_credit_rates','select'),'Credit evidence is private');
select ok(not has_table_privilege('authenticated','private.bling_monthly_credit_rates','insert'),'Clients cannot approve credit');
select ok(not has_table_privilege('service_role','private.bling_monthly_credit_rates','insert'),'Runtime cannot manufacture accounting approvals');
select ok(not has_function_privilege('authenticated','public.read_bling_fiscal_rules()','execute'),'Fiscal RPC remains backend-only');
insert into auth.users(id,email) values('bc980000-0000-4000-8000-000000000001','credit-fixture@example.invalid');
-- A fresh CI database has no accountant-provided resale configuration. Supply
-- this fixture before the baseline so the negative UPDATE must affect a row.
insert into private.bling_fiscal_rules(scenario,issuer_state,cfop,csosn,icms_rate,series,evidence_reference,
  pis_cst,cofins_cst,ipi_cst,pis_rate,cofins_rate,ipi_rate,ipi_cenq,icms_credit_rate)
values('resale_in_state_no_credit','MG','5102','102',0,2,'Synthetic isolated no-credit scenario',
  '49','49','99',0,0,0,'999',null) on conflict(scenario) do nothing;
create temporary table baseline_noncredit as select jsonb_agg(to_jsonb(r) order by scenario) data
  from private.bling_fiscal_rules r where scenario not in('resale_in_state_credit','resale_interstate_credit');
select lives_ok($q$insert into private.bling_fiscal_rules(scenario,issuer_state,cfop,csosn,icms_rate,series,evidence_reference,
  pis_cst,cofins_cst,ipi_cst,pis_rate,cofins_rate,ipi_rate,ipi_cenq,icms_credit_rate)
values('resale_in_state_credit','MG','5102','101',0,2,'Synthetic isolated scenario',
  '49','49','99',0,0,0,'999',null)
on conflict(scenario) do update set icms_credit_rate=null$q$,'Monthly credit needs no obsolete timeless rate');
select is((select icms_credit_rate from private.bling_fiscal_rules where scenario='resale_in_state_credit'),
  null::numeric,'Legacy rate remains unset');
select throws_ok($q$update private.bling_fiscal_rules set cfop='6108' where scenario='resale_in_state_credit'$q$,
  '23514',null,'Credit scenario cannot use B2C CFOP');
select throws_ok($q$update private.bling_fiscal_rules set csosn='102' where scenario='resale_in_state_credit'$q$,
  '23514',null,'Credit scenario still requires CSOSN101');
select throws_ok($q$update private.bling_fiscal_rules set icms_rate=1 where scenario='resale_in_state_credit'$q$,
  '23514',null,'Credit scenario main ICMS remains zero');
select throws_ok($q$update private.bling_fiscal_rules set pis_cst='98' where scenario='resale_in_state_credit'$q$,
  '23514',null,'Entry CST cannot leak into resale');
select throws_ok($q$update private.bling_fiscal_rules set ipi_rate=1 where scenario='resale_in_state_credit'$q$,
  '23514',null,'Credit scenario main IPI remains zero');
select throws_ok($q$update private.bling_fiscal_rules set icms_credit_rate=1.25 where scenario='resale_in_state_no_credit'$q$,
  '23514',null,'No-credit scenario cannot acquire a timeless credit rate');
select is((select jsonb_agg(to_jsonb(r) order by scenario) from private.bling_fiscal_rules r
  where scenario not in('resale_in_state_credit','resale_interstate_credit')),
  (select data from baseline_noncredit),'All non-credit scenarios retain values, series and provider IDs');
create temporary table baseline_b2c as select jsonb_agg(to_jsonb(r) order by scenario) data
  from private.bling_fiscal_rules r where scenario like 'sale%';
insert into private.bling_monthly_credit_rates(application_month,revision,reference_month,rate,evidence_reference,approved_by)
values('2098-01-01',1,'2097-12-01',1.25,'Synthetic monthly approval','bc980000-0000-4000-8000-000000000001');
select throws_ok($q$insert into private.bling_monthly_credit_rates(application_month,revision,reference_month,rate,evidence_reference,approved_by)
values('2098-02-01',1,'2098-01-01',0,'Synthetic monthly approval','bc980000-0000-4000-8000-000000000001')$q$,'23514',null,'Zero placeholder is rejected');
select throws_ok($q$insert into private.bling_monthly_credit_rates(application_month,revision,reference_month,rate,evidence_reference,approved_by)
values('2098-02-01',1,'2098-02-01',1.25,'Synthetic monthly approval','bc980000-0000-4000-8000-000000000001')$q$,'23514',null,'Wrong apuration month is rejected');
select throws_ok($q$update private.bling_monthly_credit_rates set rate=2 where application_month='2098-01-01'$q$,'23514','monthly_credit_history_is_immutable','Approval cannot be overwritten');
select throws_ok($q$delete from private.bling_monthly_credit_rates where application_month='2098-01-01'$q$,'23514','monthly_credit_history_is_immutable','Approval cannot be erased');
create temporary table prior_credit_hash as select private.bling_fiscal_configuration_hash() hash;
insert into private.bling_monthly_credit_rates(application_month,revision,reference_month,rate,evidence_reference,approved_by)
values('2098-01-01',2,'2097-12-01',2.5,'Synthetic revised approval','bc980000-0000-4000-8000-000000000001');
select isnt(private.bling_fiscal_configuration_hash(),(select hash from prior_credit_hash),'New approval invalidates old fiscal hashes');
select is((select (period->>'rate')::numeric from jsonb_array_elements(public.read_bling_fiscal_rules()) rule,
  lateral jsonb_array_elements(rule->'credit_periods') period where rule->>'scenario'='resale_in_state_credit'
  and period->>'application_month'='2098-01-01'),2.5::numeric,'Only the latest monthly approval is consumed');
select is((select count(*) from private.bling_monthly_credit_rates where application_month='2098-01-01'),2::bigint,'Earlier evidence remains available for audit');
select is((select jsonb_agg(to_jsonb(r) order by scenario) from private.bling_fiscal_rules r where scenario like 'sale%'),
  (select data from baseline_b2c),'Monthly registration preserves B2C and numbering');
set local role authenticated;
select throws_ok($q$select * from private.bling_monthly_credit_rates$q$,'42501',null,'Direct client access is rejected');
reset role;
select * from finish(true);
rollback;
