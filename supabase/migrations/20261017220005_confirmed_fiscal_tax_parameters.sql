-- Values are entered privately from reviewed accounting evidence, never seeded.
-- NULL blocks automation until the corresponding parameter has been confirmed.
alter table private.bling_fiscal_rules
  add column pis_rate numeric(7,4) check (pis_rate between 0 and 100),
  add column cofins_rate numeric(7,4) check (cofins_rate between 0 and 100),
  add column ipi_rate numeric(7,4) check (ipi_rate between 0 and 100),
  add column ipi_cenq text check (ipi_cenq ~ '^[0-9]{3}$' and ipi_cenq <> '000');

-- read_bling_fiscal_rules already serializes the whole row. These fields also
-- participate in bling_fiscal_configuration_hash, invalidating prior policies.
