import "server-only";
import { BlingError } from "./bling";

export type BlingTaxConfiguration = {
  pisCst: "49" | "98"; cofinsCst: "49" | "98"; ipiCst: "49" | "99";
  pisRate: number; cofinsRate: number; ipiRate: number; ipiCenq: string;
};
type TaxRule = {
  scenario?: string;
  pis_cst?: string | null; cofins_cst?: string | null; ipi_cst?: string | null;
  pis_rate?: number | null; cofins_rate?: number | null; ipi_rate?: number | null; ipi_cenq?: string | null;
};

// Both approved IPI CSTs use IPITrib. Entry treatment is scoped to returns.
// Never silently substitute a different CST or interpret a missing rate as zero.
export function readBlingTaxConfiguration(rule: TaxRule): BlingTaxConfiguration {
  const isReturn = rule.scenario === "return_in_state" || rule.scenario === "return_interstate";
  if (rule.pis_cst !== (isReturn ? "98" : "49") || rule.cofins_cst !== (isReturn ? "98" : "49") || rule.ipi_cst !== (isReturn ? "49" : "99")
    || isReturn && (rule.ipi_cenq !== "999" || [rule.pis_rate, rule.cofins_rate, rule.ipi_rate].some(rate => rate !== 0))
    || !/^\d{3}$/u.test(rule.ipi_cenq ?? "") || rule.ipi_cenq === "000"
    || [rule.pis_rate, rule.cofins_rate, rule.ipi_rate].some(rate =>
      typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 100
      || Number(rate.toFixed(4)) !== rate))
    throw new BlingError("fiscal_tax_parameters_required", 409);
  return { pisCst: isReturn ? "98" : "49", cofinsCst: isReturn ? "98" : "49", ipiCst: isReturn ? "49" : "99", pisRate: rule.pis_rate!,
    cofinsRate: rule.cofins_rate!, ipiRate: rule.ipi_rate!, ipiCenq: rule.ipi_cenq! };
}

// Explicit bases come from the reviewed calculation/provider item, not from a
// zero tax rate. This fragment is an unnumbered preview, never a complete NF-e.
export function buildBlingTaxXml(rule: TaxRule, bases: { pisInCents: number; cofinsInCents: number; ipiInCents: number }) {
  const tax = readBlingTaxConfiguration(rule);
  const entries = [bases.pisInCents, bases.cofinsInCents, bases.ipiInCents];
  if (entries.some(base => !Number.isSafeInteger(base) || base < 0))
    throw new BlingError("fiscal_tax_base_required", 409);
  const amount = (base: number, rate: number) => Number((BigInt(base) * BigInt(Math.round(rate * 10000)) + 500000n) / 1000000n);
  const money = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
  const pis = amount(bases.pisInCents, tax.pisRate), cofins = amount(bases.cofinsInCents, tax.cofinsRate), ipi = amount(bases.ipiInCents, tax.ipiRate);
  if ([pis, cofins, ipi].some(value => !Number.isSafeInteger(value))) throw new BlingError("fiscal_tax_base_required", 409);
  return { kind: "tax_xml_preview", transmittable: false, consumesInvoiceNumber: false, bases, amountsInCents: { pis, cofins, ipi },
    xml: `<imposto><IPI><cEnq>${tax.ipiCenq}</cEnq><IPITrib><CST>${tax.ipiCst}</CST><vBC>${money(bases.ipiInCents)}</vBC><pIPI>${tax.ipiRate.toFixed(4)}</pIPI><vIPI>${money(ipi)}</vIPI></IPITrib></IPI>`
      + `<PIS><PISOutr><CST>${tax.pisCst}</CST><vBC>${money(bases.pisInCents)}</vBC><pPIS>${tax.pisRate.toFixed(4)}</pPIS><vPIS>${money(pis)}</vPIS></PISOutr></PIS>`
      + `<COFINS><COFINSOutr><CST>${tax.cofinsCst}</CST><vBC>${money(bases.cofinsInCents)}</vBC><pCOFINS>${tax.cofinsRate.toFixed(4)}</pCOFINS><vCOFINS>${money(cofins)}</vCOFINS></COFINSOutr></COFINS></imposto>` };
}

