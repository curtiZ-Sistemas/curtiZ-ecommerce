import { describe, expect, it } from "vitest";
import { emptyFinancialSnapshot } from "./financial-control";
import { buildFinancialWorkbook } from "./financial-export";

describe("financial Excel export", () => {
  it("gera um XLSX real com as abas financeiras e tipos nativos", async () => {
    const workbook = await buildFinancialWorkbook(
      {
        ...emptyFinancialSnapshot,
        receivables: [
          {
            id: "r1",
            customer: "Cliente",
            description: "Venda",
            due_on: "2026-09-02",
            amount: 1500
          }
        ],
        expense_category_report: [
          {
            category_id: "c1",
            category_code: "2.01.01",
            category_name: "Internet",
            group_id: "g1",
            group_code: "2.01",
            group_name: "Administrativo",
            realized: 500,
            projected: 100,
            overdue: 0,
            total: 600
          }
        ]
      },
      "all",
      { from: "2026-09-01", to: "2026-09-30" }
    );
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Resumo",
      "Resumo por categorias",
      "Contas a Receber",
      "Contas a Pagar",
      "Lançamentos",
      "Aportes",
      "Categorias",
      "Contas"
    ]);
    const value = workbook.getWorksheet("Contas a Receber")?.getCell("L2").value;
    expect(value).toBe(1500);
    expect(workbook.getWorksheet("Resumo por categorias")?.getCell("E2").value).toBe(500);
    const buffer = await workbook.xlsx.writeBuffer();
    expect(new Uint8Array(buffer).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
  }, 20_000);
});
