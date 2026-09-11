export type FinancialRecord = Record<string, unknown> & { id: string };

export type FinancialSummary = {
  balance: number;
  income: number;
  expense: number;
  receivable: number;
  payable: number;
  projected_balance: number;
  overdue_receivable: number;
  overdue_payable: number;
  month_income: number;
  month_expense: number;
};

export type FinancialPoint = {
  date: string;
  income: number;
  expense: number;
  balance: number;
};

export type FinancialChartItem = { id?: string; name: string; value: number };

export type OnlineSalesSummary = {
  gross: number;
  fees: number;
  refunds: number;
  net: number;
  pending: number;
  sales_count: number;
};

export type FinancialCategoryReportItem = {
  category_id: string;
  category_code: string;
  category_name: string;
  group_id: string | null;
  group_code: string;
  group_name: string;
  realized: number;
  projected: number;
  overdue: number;
  total: number;
};

export type ContributionGroup = {
  id: string;
  name: string;
  expected_percentage: number;
  realized: number;
  ideal: number;
  difference: number;
};

export type FinancialSnapshot = {
  summary: FinancialSummary;
  series: FinancialPoint[];
  payable_by_category: FinancialChartItem[];
  receivable_by_category: FinancialChartItem[];
  expense_by_group: FinancialChartItem[];
  income_by_group: FinancialChartItem[];
  expense_category_report: FinancialCategoryReportItem[];
  income_category_report: FinancialCategoryReportItem[];
  largest_expenses: FinancialChartItem[];
  largest_receivables: FinancialChartItem[];
  account_status: FinancialChartItem[];
  contribution_groups: ContributionGroup[];
  contribution_partners: Array<{ id: string; name: string; group_name: string; realized: number }>;
  accounts: FinancialRecord[];
  categories: FinancialRecord[];
  partner_groups: FinancialRecord[];
  partners: FinancialRecord[];
  receivables: FinancialRecord[];
  payables: FinancialRecord[];
  transactions: FinancialRecord[];
  contributions: FinancialRecord[];
  audit: FinancialRecord[];
  integration_settings: FinancialRecord[];
  transfers: FinancialRecord[];
  online_sales_summary: OnlineSalesSummary;
  online_sales_by_method: FinancialChartItem[];
};

export type FinancialExportScope =
  "all" | "receivables" | "payables" | "transactions" | "contributions";

export const emptyFinancialSnapshot: FinancialSnapshot = {
  summary: {
    balance: 0,
    income: 0,
    expense: 0,
    receivable: 0,
    payable: 0,
    projected_balance: 0,
    overdue_receivable: 0,
    overdue_payable: 0,
    month_income: 0,
    month_expense: 0
  },
  series: [],
  payable_by_category: [],
  receivable_by_category: [],
  expense_by_group: [],
  income_by_group: [],
  expense_category_report: [],
  income_category_report: [],
  largest_expenses: [],
  largest_receivables: [],
  account_status: [],
  contribution_groups: [],
  contribution_partners: [],
  accounts: [],
  categories: [],
  partner_groups: [],
  partners: [],
  receivables: [],
  payables: [],
  transactions: [],
  contributions: [],
  audit: [],
  integration_settings: [],
  transfers: [],
  online_sales_summary: {
    gross: 0,
    fees: 0,
    refunds: 0,
    net: 0,
    pending: 0,
    sales_count: 0
  },
  online_sales_by_method: []
};

export function moneyToCents(value: string): number | null {
  const normalized = value
    .trim()
    .replaceAll(/[^\d,.-]/g, "")
    .replaceAll(".", "")
    .replace(",", ".");
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

export function centsToMoneyInput(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function splitInstallments(totalCents: number, count: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) throw new Error("invalid total");
  if (!Number.isInteger(count) || count <= 0 || count > 120) throw new Error("invalid count");
  if (count > totalCents) throw new Error("installment below one cent");
  const base = Math.floor(totalCents / count);
  const remainder = totalCents % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function isFinancialSnapshot(value: unknown): value is FinancialSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Boolean(record.summary && typeof record.summary === "object") &&
    [
      "series",
      "payable_by_category",
      "receivable_by_category",
      "expense_by_group",
      "income_by_group",
      "expense_category_report",
      "income_category_report",
      "largest_expenses",
      "largest_receivables",
      "account_status",
      "contribution_groups",
      "contribution_partners",
      "accounts",
      "categories",
      "partner_groups",
      "partners",
      "receivables",
      "payables",
      "transactions",
      "contributions",
      "audit",
      "integration_settings",
      "transfers",
      "online_sales_by_method"
    ].every((key) => Array.isArray(record[key])) &&
    Boolean(record.online_sales_summary && typeof record.online_sales_summary === "object")
  );
}

export function categoryPath(category: FinancialRecord): string {
  return scalarText(category.category_path) || scalarText(category.name) || "Categoria";
}

export function selectableCategories(categories: FinancialRecord[], kind: "income" | "expense") {
  return categories
    .filter(
      (category) =>
        (category.active === true || category.active === "true") &&
        category.is_group !== true &&
        category.is_group !== "true" &&
        [kind, "both"].includes(scalarText(category.kind))
    )
    .sort((a, b) => categoryPath(a).localeCompare(categoryPath(b), "pt-BR"));
}

function scalarText(value: unknown): string {
  return typeof value === "string" ? value : "";
}
