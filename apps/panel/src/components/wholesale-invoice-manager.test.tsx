import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buyerProblem, ClientStep, emptyBuyer, readHistoricalBuyer, reuseKitSelections, IssueProgress, KitStep, PaymentStep, parseIssueLine, readInvoice, readOffers,
  wholesaleReason, wholesaleStatus, WholesaleInvoiceList, MultiKitStep, MultiPaymentStep, selectionProblem, type WholesaleInvoice, type WholesaleOffer
} from "./wholesale-invoice-manager";

const noop = () => undefined;
const sizes = [{ size: "34", pairs: 1 }, { size: "35", pairs: 2 }, { size: "36", pairs: 3 }, { size: "37", pairs: 3 }, { size: "38", pairs: 2 }, { size: "39", pairs: 1 }];
const offers: WholesaleOffer[] = [{ kitId: "k1", name: "Kit Verão", description: "Tênis branco", templates: [
  { code: "standard", label: "Ficha padrão", available: 5, unitPriceInCents: 36001, sizes },
  { code: "lower_restock", label: "Ficha reposição baixa", available: 0, unitPriceInCents: 35001, sizes }
] }];
const invoice = (overrides: Partial<WholesaleInvoice> = {}): WholesaleInvoice => ({
  id: "i1", status: "authorized", stage: "authorized", kitName: "Kit Verão", templateLabel: "Ficha padrão", quantity: 2, totalInCents: 72002,
  paymentMethod: "pix", buyerName: "Loja Teste LTDA", buyerDocument: "11222333000181", invoiceId: 77, invoiceNumber: "56",
  authorized: true, errorCode: null, canCancel: false, createdAt: "2026-11-24T15:00:00Z", ...overrides
});

describe("passo 1: kit e ficha", () => {
  it("mostra os kits e, ao escolher, as fichas com distribuição, preço e estoque; a esgotada fica desabilitada", () => {
    const html = renderToStaticMarkup(<KitStep offers={offers} kitId="k1" template="standard" onKit={noop} onTemplate={noop} />);
    expect(html).toContain("Kit Verão");
    expect(html).toContain("12 pares: 34 ×1 · 35 ×2 · 36 ×3 · 37 ×3 · 38 ×2 · 39 ×1");
    expect(html).toContain("5 em estoque");
    expect(html).toContain("Esgotada");
    expect(html.match(/aria-pressed="true"/gu)).toHaveLength(2);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Ficha reposição baixa/u);
    expect(html).not.toMatch(/CFOP|NCM|série|natureza/iu);
  });

  it("avisa quando não há kit configurado", () => {
    expect(renderToStaticMarkup(<KitStep offers={[]} kitId="" template="" onKit={noop} onTemplate={noop} />)).toContain("Nenhum kit");
  });
});

describe("vários kits na mesma nota", () => {
  const multiple = [...offers, { ...offers[0]!, kitId: "k2", name: "Kit Praia" }];
  const selected = [{ kitId: "k1", template: "standard", quantity: 1, price: "360,01" },
    { kitId: "k2", template: "standard", quantity: 2, price: "360,01" }];
  it("permite uma ficha de cada kit e mostra ambos", () => {
    const html = renderToStaticMarkup(<MultiKitStep offers={multiple} selections={selected} onChange={noop} />);
    expect(html).toContain("Kits da nota (2)");
    expect(html).toContain("Kit Praia");
    expect(selectionProblem(multiple, selected)).toBeNull();
    expect(selectionProblem(multiple, [selected[0]!, selected[0]!])).not.toBeNull();
  });
  it("soma os valores e as quantidades de todos os kits", () => {
    const html = renderToStaticMarkup(<MultiPaymentStep offers={multiple} selections={selected} buyerName="Loja Teste"
      method="pix" onChange={noop} onMethod={noop} />);
    expect(html).toContain("3 fichas");
    expect(html).toContain("1.080,03");
  });
});

describe("passo 2: cliente por CNPJ", () => {
  it("aplica a máscara, mostra o estado da consulta e a IE como obrigatória", () => {
    const buyer = { ...emptyBuyer, document: "11222333000181", name: "Loja Teste LTDA" };
    const html = renderToStaticMarkup(<ClientStep buyer={buyer} lookup="found" onChange={noop} />);
    expect(html).toContain("11.222.333/0001-81");
    expect(html).toContain("Dados da empresa preenchidos");
    expect(html).toContain("Inscrição estadual (obrigatória)");
    expect(html).toContain("consulte pelo CNPJ no SINTEGRA");
  });

  it("mostra a consulta de CEP e permite completar um endereço parcial", () => {
    const html = renderToStaticMarkup(<ClientStep buyer={{ ...emptyBuyer, postalCode: "30110100" }} lookup="failed" postalLookup="partial" onChange={noop} />);
    expect(html).toContain("30110-100");
    expect(html).toContain("CEP encontrado. Complete os campos restantes.");
  });

  it("bloqueia empresa fora de MG e CNPJ inválido com avisos claros", () => {
    const outside = renderToStaticMarkup(<ClientStep buyer={{ ...emptyBuyer, document: "11222333000181", state: "SP" }} lookup="found" onChange={noop} />);
    expect(outside).toContain("Só emitimos nota de atacado para empresas de Minas Gerais");
    const invalid = renderToStaticMarkup(<ClientStep buyer={{ ...emptyBuyer, document: "11222333000182" }} lookup="idle" onChange={noop} />);
    expect(invalid).toContain("CNPJ inválido");
    expect(buyerProblem({ ...emptyBuyer, document: "11222333000181", state: "SP", name: "Loja" })).toBe("Só emitimos para empresas de Minas Gerais.");
    expect(buyerProblem({ ...emptyBuyer, document: "11222333000182" })).toBe("Informe um CNPJ válido.");
  });

  it("libera o passo quando o cadastro está completo, com inscrição estadual de 13 dígitos", () => {
    const buyer = { ...emptyBuyer, document: "11222333000181", name: "Loja Teste LTDA", regime: "simples" as const, postalCode: "30110100", street: "Rua A", number: "1", district: "Centro", city: "Belo Horizonte" };
    expect(buyerProblem(buyer)).toContain("13 dígitos");
    expect(buyerProblem({ ...buyer, registration: "ISENTA" })).toContain("Para revenda");
    expect(buyerProblem({ ...buyer, registration: "0012345678900" })).toBeNull();
    expect(buyerProblem({ ...buyer, registration: "0012345678900", regime: "normal" })).toContain("não possui regra");
    expect(buyerProblem({ ...buyer, registration: "0012345678900", regime: "mei" })).toContain("não possui regra");
    expect(buyerProblem({ ...buyer, registration: "0012345678900", regime: "" })).toContain("Confirme o regime");
    expect(buyerProblem({ ...buyer, registration: "12.3" })).toContain("13 dígitos");
    expect(buyerProblem({ ...buyer, registration: "0012345678900", postalCode: "01310100" })).toBe("Informe um CEP de Minas Gerais.");
  });
});

describe("passo 3: quantidade, preço e pagamento", () => {
  it("pré-preenche o preço, limita a quantidade ao estoque e mostra o total", () => {
    const template = offers[0]!.templates[0]!;
    const html = renderToStaticMarkup(<PaymentStep template={template} kitName="Kit Verão" quantity={5} price="360,01" method="cash"
      buyerName="Loja Teste LTDA" onQuantity={noop} onPrice={noop} onMethod={noop} />);
    expect(html).toContain("360,01");
    expect(html).toContain("Sugerido: R$ 360,01");
    expect(html).toMatch(/aria-label="Mais uma ficha"[^>]*disabled=""/u);
    expect(html).toContain("R$ 1.800,05");
    expect(html).toMatch(/aria-pressed="true"[^>]*><strong>Dinheiro/u);
    expect(html).toContain("Pix");
  });
});

describe("emissão", () => {
  const result = (status: string, code: string | null = null, inv: WholesaleInvoice | null = null) => ({ type: "result" as const, status, code, invoice: inv });

  it("mostra o progresso por etapa enquanto emite", () => {
    const html = renderToStaticMarkup(<IssueProgress steps={["contact", "sale"]} running result={null} busy={false} onRetry={noop} onCancel={noop} onClose={noop} />);
    expect(html).toContain("Cliente no Bling");
    expect(html).toContain("Não feche esta janela");
    expect(html.match(/class="done"/gu)).toHaveLength(1);
    expect(html.match(/class="active"/gu)).toHaveLength(1);
    expect(html).not.toContain("Fechar");
  });

  it("no sucesso mostra o número da nota e as ações de baixar, ver e editar no Bling", () => {
    const html = renderToStaticMarkup(<IssueProgress steps={["contact"]} running={false} result={result("authorized", null, invoice())} busy={false}
      onRetry={noop} onCancel={noop} onClose={noop} />);
    expect(html).toContain("Nota nº 56 autorizada");
    for (const label of ["Baixar DANFE", "Ver nota", "Editar no Bling"]) expect(html).toContain(`aria-label="${label}"`);
  });

  it("no erro mostra o motivo, Tentar de novo e Cancelar e devolver estoque", () => {
    const html = renderToStaticMarkup(<IssueProgress steps={["contact"]} running={false} result={result("error", "validation_error", invoice({ status: "error", canCancel: true }))}
      busy={false} onRetry={noop} onCancel={noop} onClose={noop} />);
    expect(html).toContain("O Bling recusou a operação");
    expect(html).toContain("Tentar de novo");
    expect(html).toContain("Cancelar e devolver estoque");
    expect(html).toContain('role="alert"');
  });

  it("explica a data de saída ausente sem mandar o contador ao Bling", () => {
    const html = renderToStaticMarkup(<IssueProgress steps={["contact", "sale", "draft"]} running={false}
      result={result("error", "invoice_operation_date_required", invoice({ status: "error", canCancel: true }))}
      busy={false} onRetry={noop} onCancel={noop} onClose={noop} operationDate="" onOperationDate={noop} />);
    expect(html).toContain("Data e hora de saída da mercadoria");
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain("continuar a emissão da mesma nota");
  });

  it("com envio desligado explica que a nota ficou em rascunho no Bling", () => {
    expect(wholesaleReason("bling_send_disabled")).toContain("rascunho no Bling");
    expect(wholesaleReason("desconhecido")).toBe("A nota não foi emitida. Tente de novo.");
    expect(wholesaleStatus({ status: "draft", stage: "draft_in_bling" })).toEqual({ label: "Rascunho no Bling", tone: "warn" });
  });
});

describe("lista de notas", () => {
  it("mostra data, cliente, kit e ficha, quantidade, total, status e as ações da nota autorizada", () => {
    const html = renderToStaticMarkup(<WholesaleInvoiceList invoices={[invoice()]} busyId="" onRetry={noop} onCancel={noop} />);
    expect(html).toContain("Loja Teste LTDA");
    expect(html).toContain("11.222.333/0001-81");
    expect(html).toContain("24/11/26");
    expect(html).toContain("Kit Verão");
    expect(html).toContain("Ficha padrão · 2 fichas");
    expect(html).toContain("R$ 720,02");
    expect(html).toContain("Autorizada");
    expect(html).toContain("NF-e nº 56");
    expect(html).toContain('aria-label="Ver nota"');
    expect(html).not.toContain("Tentar de novo");
  });

  it("oferece tentar de novo e cancelar nas notas com erro, com o motivo, e não mostra ações de PDF", () => {
    const html = renderToStaticMarkup(<WholesaleInvoiceList busyId="" onRetry={noop} onCancel={noop}
      invoices={[invoice({ status: "error", authorized: false, invoiceId: null, invoiceNumber: null, errorCode: "uncertain_write", canCancel: true })]} />);
    expect(html).toContain("Com erro");
    expect(html).toContain("O Bling ainda não confirmou a operação");
    expect(html).toContain("Tentar de novo");
    expect(html).toContain("Cancelar e devolver estoque");
    expect(html).not.toContain('aria-label="Ver nota"');
  });

  it("mostra o estado vazio", () => {
    expect(renderToStaticMarkup(<WholesaleInvoiceList invoices={[]} busyId="" onRetry={noop} onCancel={noop} />)).toContain("Nenhuma nota de atacado ainda");
  });
});

describe("leitura das respostas", () => {
  it("lê as linhas do stream e ignora linhas quebradas", () => {
    expect(parseIssueLine('{"type":"step","step":"sale"}')).toEqual({ type: "step", step: "sale" });
    expect(parseIssueLine('{"type":"result","status":"waiting","code":"bling_send_disabled","invoice":null}'))
      .toEqual({ type: "result", status: "waiting", code: "bling_send_disabled", invoice: null });
    expect(parseIssueLine("{quebrado")).toBeNull();
    expect(parseIssueLine('{"type":"outro"}')).toBeNull();
  });

  it("descarta kits e notas incompletos", () => {
    expect(readOffers([{ kitId: "k", name: "Kit", templates: [{ code: "standard", available: 1, unitPriceInCents: 100, sizes: [] }, { code: "x" }] }, { nome: "sem id" }])).toHaveLength(1);
    expect(readOffers([{ kitId: "k", name: "Kit", templates: [{ code: "standard", available: 1, unitPriceInCents: 100, sizes: [] }, { code: "x" }] }])[0]?.templates).toHaveLength(1);
    expect(readInvoice({ id: "i", quantity: 1 })).toBeNull();
    expect(readInvoice({ id: "i", quantity: 1, totalInCents: 5, status: "draft" })?.status).toBe("draft");
  });
});


describe("histórico de cancelamentos e emissão externa", () => {
  it("permite remover da lista somente o cancelamento concluído", () => {
    const html = renderToStaticMarkup(<WholesaleInvoiceList invoices={[
      invoice({ status: "cancelled", authorized: false, canCancel: false }),
      invoice({ id: "i2", status: "cancelled", authorized: false, canCancel: true, cancelPending: true })
    ]} busyId="" onRetry={noop} onCancel={noop} onArchive={noop} />);
    expect(html.match(/Remover da lista/gu)).toHaveLength(1);
    expect(html).toContain("Concluir cancelamento");
  });
  it("preserva a nota emitida externamente e não oferece nova emissão nem cancelamento", () => {
    const html = renderToStaticMarkup(<WholesaleInvoiceList invoices={[invoice({
      status: "error", authorized: false, canCancel: false, externalReported: true, externalSeries: "002", externalNumber: "000000003"
    })]} busyId="" onRetry={noop} onCancel={noop} onArchive={noop} />);
    expect(html).toContain("Emitida externamente");
    expect(html).toContain("Conciliação pendente");
    expect(html).toContain('aria-label="Ver nota"');
    expect(html).not.toContain("Tentar de novo");
    expect(html).not.toContain("Cancelar e devolver estoque");
  });
});


describe("clientes recorrentes", () => {
  it("permite nova nota somente a partir de emissão anterior", () => {
    const html = renderToStaticMarkup(<WholesaleInvoiceList invoices={[
      invoice(), invoice({ id: "i2", status: "error", authorized: false }),
      invoice({ id: "i3", status: "error", authorized: false, externalReported: true })
    ]} busyId="" onRetry={noop} onCancel={noop} onNewForClient={noop} />);
    expect(html.match(/Nova nota para este cliente/gu)).toHaveLength(2);
  });
  it("preenche o cadastro salvo sem presumir o regime de notas antigas", () => {
    const buyer = readHistoricalBuyer({ document: "11222333000181", name: "Loja Teste", registration: "0012345678900",
      address: { postal_code: "30110100", street: "Rua A", number: "1", district: "Centro", city: "Belo Horizonte", state: "MG" } });
    expect(buyer).toMatchObject({ document: "11222333000181", name: "Loja Teste", postalCode: "30110100", regime: "" });
    expect(readHistoricalBuyer({ document: "invalido" })).toBeNull();
  });
  it("reaproveita apenas fichas disponíveis e usa o preço atual", () => {
    const copied = reuseKitSelections(offers, [{ kitId: "k1", template: "standard", quantity: 6 }, { kitId: "k2", template: "standard", quantity: 1 }]);
    expect(copied.adjusted).toBe(true);
    expect(copied.selections).toEqual([{ kitId: "k1", template: "standard", quantity: 5, price: "360,01" }]);
  });
  it("mostra a pesquisa opcional sem impedir o cadastro manual", () => {
    const html = renderToStaticMarkup(<ClientStep buyer={emptyBuyer} lookup="idle" onChange={noop} onHistoricalClient={noop} />);
    expect(html).toContain("Buscar cliente pelo nome");
    expect(html).toContain("CNPJ do cliente");
  });
});


it("exibe rascunho sem validade fiscal e permite fechar sem transmitir", () => {
  const html = renderToStaticMarkup(<IssueProgress steps={["draft"]} running={false} busy={false}
    result={{ type: "result", status: "ready", code: null, invoice: invoice({ authorized: false, status: "draft" }),
      review: { hash: "a".repeat(64), number: "56", series: "3", date: "", operationDate: "", issuer: "11222333000181",
      nature: "Venda", buyer: "Loja Teste", document: "11222333000181", registration: "123", address: "Rua A", totalInCents: 72002,
      freight: "Transporte próprio", payment: "Pix", cfop: "5102", csosn: "102", items: [] } }}
    onRetry={noop} onCancel={noop} onClose={noop} onTransmit={noop} />);
  expect(html).toContain("Sem validade fiscal");
  expect(html).toContain("Prosseguir e enviar à SEFAZ");
  expect(html).toContain("Fechar e enviar depois");
});
