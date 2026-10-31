-- Separate resale from B2C; no taxpayer, credit rate, nature or number is guessed.
alter table private.bling_fiscal_rules drop constraint bling_fiscal_rules_scenario_check;
alter table private.bling_fiscal_rules add constraint bling_fiscal_rules_scenario_check check(scenario in (
  'sale_in_state','sale_interstate_taxpayer','sale_interstate_non_taxpayer','return_in_state','return_interstate',
  'resale_in_state_no_credit','resale_interstate_no_credit','resale_in_state_credit','resale_interstate_credit'));
alter table private.bling_fiscal_rules add column icms_credit_rate numeric(7,4)
  check(icms_credit_rate between 0 and 100);
alter table private.bling_fiscal_rules add constraint bling_resale_credit_scope check(
  icms_credit_rate is null or scenario in('resale_in_state_credit','resale_interstate_credit'));
alter table private.bling_fiscal_rules add constraint bling_resale_tax_contract check(
  scenario not in('resale_in_state_no_credit','resale_interstate_no_credit','resale_in_state_credit','resale_interstate_credit')
  or coalesce(
    cfop=case when scenario in('resale_in_state_credit','resale_in_state_no_credit') then '5102' else '6102' end
    and csosn=case when scenario in('resale_in_state_credit','resale_interstate_credit') then '101' else '102' end
    and icms_rate=0 and pis_cst='49' and cofins_cst='49' and ipi_cst='99'
    and pis_rate=0 and cofins_rate=0 and ipi_rate=0 and ipi_cenq='999'
    and case when scenario in('resale_in_state_credit','resale_interstate_credit') then icms_credit_rate is not null
      else icms_credit_rate is null end,false));
-- Existing RLS, service-only RPCs, commercial gates and data remain unchanged.

