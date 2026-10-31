import "server-only";
import { BlingError } from "./bling";

export type BlingMonthlyCredit = {
  applicationMonth: string; referenceMonth: string; rate: number; revision: number;
  evidenceReference: string; approvedBy: string; approvedAt: string;
};

export function readBlingMonthlyCredit(value: unknown, saleDate: string | undefined): BlingMonthlyCredit {
  if (!saleDate || !/^\d{4}-\d{2}-\d{2}$/u.test(saleDate)
    || !Number.isFinite(Date.parse(`${saleDate}T12:00:00Z`))
    || new Date(`${saleDate}T12:00:00Z`).toISOString().slice(0, 10) !== saleDate)
    throw new BlingError("fiscal_credit_competence_required", 409);
  const month = `${saleDate.slice(0, 7)}-01`;
  const date = new Date(`${month}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  const referenceMonth = date.toISOString().slice(0, 10);
  const rows = Array.isArray(value) ? value.filter((v): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v)).filter(v => v.application_month === month) : [];
  // The backend supplies one immutable, latest approved revision per month.
  const entry = rows[0];
  const rate = entry?.rate;
  const numericRate = typeof rate === "number" ? rate : typeof rate === "string" && /^\d+(\.\d{1,4})?$/u.test(rate) ? Number(rate) : NaN;
  if (rows.length !== 1 || !entry || entry.reference_month !== referenceMonth
    || !Number.isFinite(numericRate) || numericRate <= 0 || numericRate > 100 || Number(numericRate.toFixed(4)) !== numericRate
    || !Number.isSafeInteger(entry.revision) || Number(entry.revision) < 1
    || typeof entry.evidence_reference !== "string" || entry.evidence_reference.length < 10
    || typeof entry.approved_by !== "string" || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/iu.test(entry.approved_by)
    || typeof entry.approved_at !== "string" || !Number.isFinite(Date.parse(entry.approved_at)))
    throw new BlingError("fiscal_monthly_credit_required", 409);
  return { applicationMonth: month, referenceMonth, rate: numericRate, revision: Number(entry.revision),
    evidenceReference: entry.evidence_reference, approvedBy: entry.approved_by, approvedAt: entry.approved_at };
}

// Bases must be explicitly reviewed against the provider's fiscal contract.
// Sum the rounded item credits, rather than rounding the aggregate base.
export function calculateBlingMonthlyCredit(credit: BlingMonthlyCredit, basesInCents: number[]) {
  if (!basesInCents.length || basesInCents.some(base => !Number.isSafeInteger(base) || base < 0)
    || !Number.isFinite(credit.rate) || credit.rate <= 0 || credit.rate > 100 || Number(credit.rate.toFixed(4)) !== credit.rate)
    throw new BlingError("fiscal_credit_base_required", 409);
  const scaledRate = BigInt(Math.round(credit.rate * 10000));
  const items = basesInCents.map(base => Number((BigInt(base) * scaledRate + 500000n) / 1000000n));
  const totalInCents = items.reduce((sum, item) => sum + item, 0);
  if (!Number.isSafeInteger(totalInCents)) throw new BlingError("fiscal_credit_base_required", 409);
  const money = `${Math.floor(totalInCents / 100)},${String(totalInCents % 100).padStart(2, "0")}`;
  const percentage = credit.rate.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "").replace(".", ",");
  return { itemsInCents: items, totalInCents, rate: credit.rate,
    message: `PERMITE O APROVEITAMENTO DO CRÉDITO DE ICMS NO VALOR DE R$ ${money}, CORRESPONDENTE À ALÍQUOTA DE ${percentage}%, NOS TERMOS DO ART. 23 DA LEI COMPLEMENTAR Nº 123/2006.` };
}
