begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into private.bling_fiscal_rules(scenario,issuer_state,cfop,csosn,icms_rate,series,evidence_reference,pis_cst,cofins_cst,ipi_cst)
values('sale_in_state','MG','5102','102',0,2,'Isolated parameter test','49','49','99');
select is(public.read_bling_fiscal_rules()->0->>'pis_rate',null::text,'No approved zero rate is invented by migration');
select is(public.read_bling_fiscal_rules()->0->>'ipi_cenq',null::text,'No cEnq is seeded without evidence');
create temporary table tax_initial as select private.bling_fiscal_configuration_hash() hash;
update private.bling_fiscal_rules set pis_rate=0,cofins_rate=0,ipi_rate=0,ipi_cenq='999' where scenario='sale_in_state';
select is(public.read_bling_fiscal_rules()->0->>'ipi_cenq','999','Explicit cEnq is included in backend contract');
select is((public.read_bling_fiscal_rules()->0->>'pis_rate')::numeric,0::numeric,'Explicit zero survives serialization');
select isnt(private.bling_fiscal_configuration_hash(),(select hash from tax_initial),'Tax parameters invalidate prior policy hash');
select throws_ok($$update private.bling_fiscal_rules set pis_rate=-1$$,'23514',null,'Negative rates are rejected');
select throws_ok($$update private.bling_fiscal_rules set ipi_cenq='999<test>'$$,'23514',null,'Invalid cEnq is rejected');
select throws_ok($$update private.bling_fiscal_rules set ipi_cenq='000'$$,'23514',null,'Zero cEnq is not accepted as an approved code');
select ok(not has_table_privilege('authenticated','private.bling_fiscal_rules','update'),'Clients cannot override approved tax rates');
select is((select count(*)from private.bling_fiscal_automation_policy),0::bigint,'Tax fields do not activate fiscal policy');
select * from finish();
rollback;
