-- Monthly approval is the only consumed credit-rate source. Retain legacy
-- values for history, without requiring one to configure a CSOSN101 scenario.
-- One atomic ALTER; no data, series, provider IDs, grants or gates are changed.
alter table private.bling_fiscal_rules
  drop constraint bling_resale_tax_contract,
  add constraint bling_resale_tax_contract check(
    scenario not in('resale_in_state_no_credit','resale_interstate_no_credit','resale_in_state_credit','resale_interstate_credit')
    or coalesce(
      cfop=case when scenario in('resale_in_state_credit','resale_in_state_no_credit') then '5102' else '6102' end
      and csosn=case when scenario in('resale_in_state_credit','resale_interstate_credit') then '101' else '102' end
      and icms_rate=0 and pis_cst='49' and cofins_cst='49' and ipi_cst='99'
      and pis_rate=0 and cofins_rate=0 and ipi_rate=0 and ipi_cenq='999'
      and (scenario in('resale_in_state_credit','resale_interstate_credit') or icms_credit_rate is null), false));
