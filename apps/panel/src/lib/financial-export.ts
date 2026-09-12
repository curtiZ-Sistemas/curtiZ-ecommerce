import type { CellValue, Workbook, Worksheet } from "exceljs";
import type { FinancialExportScope, FinancialRecord, FinancialSnapshot } from "./financial-control";

type ExportColumn = {
  header: string;
  key: string;
  width?: number;
  kind?: "date" | "datetime" | "money";
};

const moneyKeys = new Set([
  "amount", "value", "initial_balance", "gross_amount", "provider_fee",
  "net_received_amount", "refunded_amount", "current_balance"
]);

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function dateValue(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00-03:00` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function configureSheet(sheet: Worksheet, columns: ExportColumn[]) {
  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width ?? 18
  }));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: `${sheet.getColumn(columns.length).letter}1` };
  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF982920" } };
  header.alignment = { vertical: "middle" };
  columns.forEach((column, index) => {
    if (column.kind === "money")
      sheet.getColumn(index + 1).numFmt = "R$ #,##0.00;[Red]-R$ #,##0.00";
    if (column.kind === "date") sheet.getColumn(index + 1).numFmt = "dd/mm/yyyy";
    if (column.kind === "datetime") sheet.getColumn(index + 1).numFmt = "dd/mm/yyyy hh:mm";
  });
}

function addDataSheet(
  workbook: Workbook,
  name: string,
  columns: ExportColumn[],
  rows: FinancialRecord[]
) {
  const sheet = workbook.addWorksheet(name);
  configureSheet(sheet, columns);
  for (const item of rows) {
    const row: Record<string, CellValue> = {};
    for (const column of columns) {
      const value = item[column.key];
      row[column.key] =
        column.kind === "date" || column.kind === "datetime"
          ? dateValue(value)
          : column.kind === "money" || moneyKeys.has(column.key)
            ? Number(value) || 0
            : text(value);
    }
    sheet.addRow(row);
  }
  if (rows.length && columns.some((column) => column.key === "amount")) {
    const totalRow = sheet.addRow({
      description: "Total",
      amount: {
        formula: `SUM(${sheet.getColumn("amount").letter}2:${sheet.getColumn("amount").letter}${rows.length + 1})`
      }
    });
    totalRow.font = { bold: true };
  }
  return sheet;
}

const receivableColumns: ExportColumn[] = [
  { header: "Código da conta", key: "category_code", width: 18 },
  { header: "Grupo", key: "group_name", width: 28 },
  { header: "Subconta", key: "subcategory_name", width: 24 },
  { header: "Tipo", key: "financial_type", width: 18 },
  { header: "Descrição", key: "description", width: 34 },
  { header: "Cliente", key: "customer", width: 28 },
  { header: "Documento", key: "document_number" },
  { header: "Emissão", key: "issued_on", kind: "date" },
  { header: "Vencimento", key: "due_on", kind: "date" },
  { header: "Recebimento", key: "received_on", kind: "date" },
  { header: "Status", key: "display_status" },
  { header: "Valor", key: "amount", kind: "money" },
  { header: "Origem", key: "origin", width: 18 },
  { header: "Pedido", key: "order_code", width: 18 },
  { header: "ID pagamento Mercado Pago", key: "mercadopago_payment_id", width: 28 },
  { header: "Meio de pagamento", key: "payment_method", width: 24 },
  { header: "Parcelas do pagamento", key: "payment_installments", width: 18 },
  { header: "Valor bruto", key: "gross_amount", kind: "money" },
  { header: "Taxa Mercado Pago", key: "provider_fee", kind: "money" },
  { header: "Valor líquido", key: "net_received_amount", kind: "money" },
  { header: "Reembolsado", key: "refunded_amount", kind: "money" },
  { header: "Conta financeira", key: "account_name", width: 22 },
  { header: "Responsável", key: "responsible_name", width: 24 },
  { header: "Parcela", key: "installment_number" },
  { header: "Total parcelas", key: "installment_count" },
  { header: "Observações", key: "notes", width: 34 }
];

const payableColumns: ExportColumn[] = receivableColumns.map((column) => {
  if (column.key === "customer") return { ...column, header: "Fornecedor", key: "supplier" };
  if (column.key === "received_on") return { ...column, header: "Pagamento", key: "paid_on" };
  return column;
});

const transactionColumns: ExportColumn[] = [
  { header: "Código da conta", key: "category_code", width: 18 },
  { header: "Grupo", key: "group_name", width: 28 },
  { header: "Subconta", key: "subcategory_name", width: 24 },
  { header: "Data", key: "occurred_on", kind: "date" },
  { header: "Tipo", key: "type" },
  { header: "Descrição", key: "description", width: 36 },
  { header: "Categoria", key: "category_name", width: 22 },
  { header: "Origem", key: "origin" },
  { header: "Valor", key: "amount", kind: "money" },
  { header: "Conta", key: "account_name", width: 22 },
  { header: "Responsável", key: "responsible_name", width: 24 },
  { header: "Conta a receber", key: "receivable_id", width: 38 },
  { header: "Conta a pagar", key: "payable_id", width: 38 },
  { header: "Estornado em", key: "reversed_at", kind: "datetime" }
];

function addCategorySummarySheet(workbook: Workbook, data: FinancialSnapshot) {
  const rows: FinancialRecord[] = [
    ...data.expense_category_report.map((item) => ({
      ...item,
      id: `expense:${item.category_id}`,
      financial_type: "Despesa"
    })),
    ...data.income_category_report.map((item) => ({
      ...item,
      id: `income:${item.category_id}`,
      financial_type: "Receita"
    }))
  ];
  return addDataSheet(
    workbook,
    "Resumo por categorias",
    [
      { header: "Tipo", key: "financial_type", width: 14 },
      { header: "Código", key: "category_code", width: 16 },
      { header: "Grupo", key: "group_name", width: 28 },
      { header: "Subconta", key: "category_name", width: 26 },
      { header: "Realizado", key: "realized", kind: "money", width: 18 },
      { header: "Previsto", key: "projected", kind: "money", width: 18 },
      { header: "Vencido", key: "overdue", kind: "money", width: 18 },
      { header: "Total", key: "total", kind: "money", width: 18 }
    ],
    rows
  );
}

const contributionColumns: ExportColumn[] = [
  { header: "Data", key: "contributed_on", kind: "date" },
  { header: "Sócio", key: "partner_name", width: 28 },
  { header: "Grupo", key: "group_name", width: 28 },
  { header: "Descrição", key: "description", width: 34 },
  { header: "Valor", key: "amount", kind: "money" },
  { header: "Conta", key: "account_name", width: 22 },
  { header: "Observações", key: "notes", width: 34 }
];

export async function buildFinancialWorkbook(
  data: FinancialSnapshot,
  scope: FinancialExportScope,
  period: { from: string; to: string }
) {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.creator = "curti Z";
  workbook.created = new Date();
  workbook.modified = new Date();

  if (scope === "all") {
    const summary = workbook.addWorksheet("Resumo");
    summary.columns = [{ width: 34 }, { width: 22 }];
    summary.addRows([
      ["Controle financeiro curti Z", ""],
      ["Período", `${period.from} a ${period.to}`],
      ["Saldo atual", data.summary.balance],
      ["Entradas no período", data.summary.income],
      ["Saídas no período", data.summary.expense],
      ["Total a receber", data.summary.receivable],
      ["Total a pagar", data.summary.payable],
      ["Saldo projetado", data.summary.projected_balance],
      ["Vencido a receber", data.summary.overdue_receivable],
      ["Vencido a pagar", data.summary.overdue_payable],
      ["Vendas brutas do site", data.online_sales_summary.gross],
      ["Taxas Mercado Pago", data.online_sales_summary.fees],
      ["Reembolsos", data.online_sales_summary.refunds],
      ["Receita líquida do site", data.online_sales_summary.net],
      ["Vendas pendentes", data.online_sales_summary.pending]
    ]);
    summary.getRow(1).font = { bold: true, size: 16, color: { argb: "FF982920" } };
    summary.getColumn(2).numFmt = "R$ #,##0.00;[Red]-R$ #,##0.00";
    addCategorySummarySheet(workbook, data);
  }

  const inPeriod = (item: FinancialRecord, key: string) => {
    const value = text(item[key]);
    return value >= period.from && value <= period.to;
  };
  const receivables = data.receivables
    .filter((item) => inPeriod(item, "due_on"))
    .map((item) => ({ ...item, financial_type: "Conta a receber" }));
  const payables = data.payables
    .filter((item) => inPeriod(item, "due_on"))
    .map((item) => ({ ...item, financial_type: "Conta a pagar" }));
  const contributions = data.contributions.filter((item) => inPeriod(item, "contributed_on"));

  if (scope === "all" || scope === "receivables")
    addDataSheet(workbook, "Contas a Receber", receivableColumns, receivables);
  if (scope === "all" || scope === "payables")
    addDataSheet(workbook, "Contas a Pagar", payableColumns, payables);
  if (scope === "all" || scope === "transactions")
    addDataSheet(workbook, "Lançamentos", transactionColumns, data.transactions);
  if (scope === "all" || scope === "contributions")
    addDataSheet(workbook, "Aportes", contributionColumns, contributions);
  if (scope === "all") {
    addDataSheet(
      workbook,
      "Categorias",
      [
        { header: "Nome", key: "name", width: 30 },
        { header: "Código", key: "code", width: 16 },
        { header: "Grupo", key: "parent_name", width: 28 },
        { header: "Totalizadora", key: "is_group", width: 16 },
        { header: "Aplicação", key: "kind", width: 20 },
        { header: "Ordem", key: "sort_order", width: 12 },
        { header: "Ativa", key: "active", width: 14 }
      ],
      data.categories
    );
    addDataSheet(
      workbook,
      "Contas",
      [
        { header: "Nome", key: "name", width: 30 },
        { header: "Saldo inicial", key: "initial_balance", kind: "money", width: 22 },
        { header: "Saldo atual", key: "current_balance", kind: "money", width: 22 },
        { header: "Ativa", key: "active", width: 14 }
      ],
      data.accounts
    );
    addDataSheet(
      workbook,
      "Transferências",
      [
        { header: "Data", key: "occurred_on", kind: "date" },
        { header: "Descrição", key: "description", width: 36 },
        { header: "Origem", key: "source_account_name", width: 24 },
        { header: "Destino", key: "destination_account_name", width: 24 },
        { header: "Valor", key: "amount", kind: "money" },
        { header: "Referência", key: "external_reference", width: 24 },
        { header: "Responsável", key: "responsible_name", width: 24 }
      ],
      data.transfers
    );
  }

  return workbook;
}

export async function exportFinancialWorkbook(
  data: FinancialSnapshot,
  scope: FinancialExportScope,
  period: { from: string; to: string }
) {
  const workbook = await buildFinancialWorkbook(data, scope, period);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `controle-financeiro-${period.from}-${period.to}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
