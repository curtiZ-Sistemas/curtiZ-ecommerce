begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.bling_fiscal_rules'::regclass),'Fiscal rules retain forced RLS');
select ok(not has_table_privilege('authenticated','private.bling_fiscal_rules','update'),'Customer cannot approve credit or tax parameters');
select ok(not has_function_privilege('authenticated','public.read_bling_fiscal_rules()','execute'),'Fiscal scenarios remain backend-only');
create temporary table prior_rules as select * from private.bling_fiscal_rules where scenario not like 'resale%';
create temporary table prior_natures as select jsonb_agg(to_jsonb(n) order by scenario,final_consumer) data from private.bling_fiscal_natures n;
insert into private.bling_fiscal_rules(scenario,issuer_state,cfop,csosn,icms_rate,series,evidence_reference,
  pis_cst,cofins_cst,ipi_cst,pis_rate,cofins_rate,ipi_rate,ipi_cenq)
values('resale_interstate_no_credit','MG','6102','102',0,2,'Synthetic isolated policy fixture','49','49','99',0,0,0,'999')
on conflict(scenario) do update set cfop=excluded.cfop,csosn=excluded.csosn,icms_rate=0,pis_cst='49',cofins_cst='49',ipi_cst='99',
  pis_rate=0,cofins_rate=0,ipi_rate=0,ipi_cenq='999',icms_credit_rate=null;
select is((select cfop::text from private.bling_fiscal_rules where scenario='resale_interstate_no_credit'),'6102','Resale non-contributor is not B2C 6108');
select throws_ok($$update private.bling_fiscal_rules set cfop='6108' where scenario='resale_interstate_no_credit'$$,'23514',null,'B2C CFOP cannot leak into resale');
select throws_ok($$update private.bling_fiscal_rules set csosn='101' where scenario='resale_interstate_no_credit'$$,'23514',null,'Credit requires a distinct approved scenario');
select throws_ok($$update private.bling_fiscal_rules set pis_rate=1 where scenario='resale_interstate_no_credit'$$,'23514',null,'Main tax rates remain zero');
select throws_ok($$update private.bling_fiscal_rules set ipi_cenq=null where scenario='resale_interstate_no_credit'$$,'23514',null,'SQL NULL cannot bypass the resale contract');
select throws_ok($$update private.bling_fiscal_rules set icms_credit_rate=1 where scenario='resale_interstate_no_credit'$$,'23514',null,'No credit rate on a no-credit scenario');
select lives_ok($$insert into private.bling_fiscal_rules(scenario,issuer_state,cfop,csosn,icms_rate,series,evidence_reference,pis_cst,cofins_cst,ipi_cst,pis_rate,cofins_rate,ipi_rate,ipi_cenq)
  values('resale_in_state_credit','MG','5102','101',0,2,'Synthetic isolated credit fixture','49','49','99',0,0,0,'999')$$,'Credit configuration does not require a timeless rate');
select is((select jsonb_array_length(r->'credit_periods') from jsonb_array_elements(public.read_bling_fiscal_rules()) r
  where r->>'scenario'='resale_in_state_credit'),0,'A missing monthly approval is never manufactured');
update private.bling_fiscal_rules set icms_credit_rate=1.25 where scenario='resale_in_state_credit';
select is((select icms_credit_rate from private.bling_fiscal_rules where scenario='resale_in_state_credit'),1.25::numeric,'Historical fixture rate can be retained without authorizing monthly credit');
select lives_ok($$update private.bling_fiscal_rules set icms_credit_rate=null where scenario='resale_in_state_credit'$$,'Legacy rate may remain absent');
select throws_ok($$update private.bling_fiscal_rules set icms_credit_rate=-1 where scenario='resale_in_state_credit'$$,'23514',null,'Negative credit rejected');
select is((select jsonb_agg(to_jsonb(n) order by scenario,final_consumer) from private.bling_fiscal_natures n),
  (select data from prior_natures),'No external nature is invented or changed');
create temporary table prior_hash as select private.bling_fiscal_configuration_hash() hash;
update private.bling_fiscal_rules set icms_credit_rate=2 where scenario='resale_in_state_credit';
select isnt(private.bling_fiscal_configuration_hash(),(select hash from prior_hash),'Credit change invalidates old fiscal approval');
select is((select jsonb_agg(to_jsonb(r) order by scenario) from private.bling_fiscal_rules r where scenario not like 'resale%'),
  (select jsonb_agg(to_jsonb(r) order by scenario) from prior_rules r),'B2C and return settings untouched by fixture');
select * from finish(true);
rollback;

