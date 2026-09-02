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
        ]
      },
      "all",
      { from: "2026-09-01", to: "2026-09-30" }
    );
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Resumo",
      "Contas a Receber",
      "Contas a Pagar",
      "Lançamentos",
      "Aportes",
      "Categorias",
      "Contas"
    ]);
    const value = workbook.getWorksheet("Contas a Receber")?.getCell("J2").value;
    expect(value).toBe(1500);
    const buffer = await workbook.xlsx.writeBuffer();
    expect(new Uint8Array(buffer).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
  }, 20_000);
});
