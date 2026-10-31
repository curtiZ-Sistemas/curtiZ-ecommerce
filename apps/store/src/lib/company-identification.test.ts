import { describe, expect, it } from "vitest";
import { formatCnpj, parseCompanyIdentification } from "./company-identification";

const row = {
  legal_name: "Empresa Exemplo Ltda",
  trade_name: "curti Z",
  tax_id: "11222333000181",
  address: "Rua Exemplo, 100, Centro, Cidade - UF, 00000-000",
  email: "contato@example.test",
  phone: "(11) 4000-0000",
  support_channel: null
};

describe("identificação do fornecedor", () => {
  it("formata o CNPJ apenas na exibição", () => {
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("converte a linha válida e normaliza campos opcionais vazios para null", () => {
    expect(parseCompanyIdentification([{ ...row, email: "", support_channel: undefined }])).toMatchObject({
      legalName: "Empresa Exemplo Ltda",
      taxId: "11222333000181",
      email: null,
      supportChannel: null
    });
  });

  it("descarta dados ausentes ou malformados em vez de exibir informação incompleta", () => {
    expect(parseCompanyIdentification([])).toBeNull();
    expect(parseCompanyIdentification(null)).toBeNull();
    expect(parseCompanyIdentification([{ ...row, tax_id: "11.222.333/0001-81" }])).toBeNull();
    expect(parseCompanyIdentification([{ ...row, legal_name: "" }])).toBeNull();
    expect(parseCompanyIdentification({ not: "an array" })).toBeNull();
  });
});
