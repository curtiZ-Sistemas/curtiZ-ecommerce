-- Owner-provided revised entry policy. No gate, series or provider ID changes.
-- Apply only after isolated tests and full CI approval. Not a seed/migration.
begin;
do $$
begin
  if (select count(*) from private.bling_fiscal_rules
    where scenario in ('return_in_state','return_interstate') and issuer_state='MG'
      and cfop=case when scenario='return_in_state' then '1202' else '2202' end
      and csosn='102' and series=3 and ipi_cst='49' and ipi_cenq='999'
      and pis_rate=0 and cofins_rate=0 and ipi_rate=0
      and pis_cst in ('49','98') and cofins_cst in ('49','98'))<>2 then
    raise exception 'return_base_configuration_requires_review';
  end if;
end;
$$;
update private.bling_fiscal_rules set pis_cst='98',cofins_cst='98',updated_at=now(),
  evidence_reference='Revised owner-provided entry policy: PIS98/COFINS98, IPI49/cEnq999, zero rates; series preserved.'
where scenario in ('return_in_state','return_interstate')
  and (pis_cst is distinct from '98' or cofins_cst is distinct from '98');
commit;
