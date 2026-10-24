-- Explicit owner-provided configuration; run after the schema migration and CI.
-- Not a seed. Preserves existing series and every provider ID. Opens no gate.
begin;
do $$
begin
  if (select count(*) from private.bling_fiscal_rules where scenario in('return_in_state','return_interstate')
      and issuer_state='MG' and csosn='102' and icms_rate=0
      and cfop=case when scenario='return_in_state' then '1202' else '2202' end)<>2
    or not exists(select 1 from private.bling_fiscal_rules where scenario='sale_in_state'
      and issuer_state='MG' and cfop='5102' and csosn='102' and document_model=55) then
    raise exception 'fiscal_base_configuration_required';
  end if;
  if exists(select 1 from private.bling_fiscal_rules r join private.bling_fiscal_natures n using(scenario)
    where r.scenario in('return_in_state','return_interstate') and r.ipi_cst is distinct from '49') then
    raise exception 'return_nature_revalidation_required';
  end if;
end;
$$;
update private.bling_fiscal_rules set pis_cst='49',cofins_cst='49',ipi_cst='49',
  pis_rate=0,cofins_rate=0,ipi_rate=0,ipi_cenq='999',updated_at=now(),
  evidence_reference='Owner accountant guidance 2026-10-24: PF final-consumer returns 49/49/49, cEnq999, rates0. Existing series preserved, production numbering unconfirmed.'
where scenario in('return_in_state','return_interstate');
insert into private.bling_fiscal_rules(scenario,issuer_state,cfop,csosn,icms_rate,document_model,series,
  pis_cst,cofins_cst,ipi_cst,pis_rate,cofins_rate,ipi_rate,ipi_cenq,evidence_reference)
select region.scenario,base.issuer_state,region.cfop,'102',0,55,base.series,'49','49','99',0,0,0,'999',
  'Owner accountant guidance 2026-10-24: resale without credit; individual pairs; finalConsumer=false. Existing series preserved, provider nature unverified.'
from private.bling_fiscal_rules base cross join(values
  ('resale_in_state_no_credit','5102'),('resale_interstate_no_credit','6102')) as region(scenario,cfop)
where base.scenario='sale_in_state'
on conflict(scenario) do nothing;
-- No CSOSN101 row: the applicable credit rate was not supplied.
-- Old approvals are not regenerated; their configuration hashes become stale.
commit;

