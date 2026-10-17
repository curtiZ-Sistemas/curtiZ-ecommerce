import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { expandBlingFiscalKit, type BlingClient } from "@curtiz/integrations";
import { blingFiscalDraftBody, prepareBlingFiscalDraft } from "./bling-invoice-draft";
const input = { document: "12345678909", icmsTaxpayer: false, natureId: 10, totalInCents: 5594, shippingInCents: 0, discountInCents: 0, additionalInCents: 0 };
const commercial = [{ sku: "KIT", unit: "UN", quantity: 1, unitPriceInCents: 5594 }];
const items = expandBlingFiscalKit({ sku: "KIT", description: "Kit", unit: "UN", quantity: 1, unitPriceInCents: 5594,
  pairsPerSku: 3, fiscalUnitApproved: false, ncm: "64022000", origin: 0, cest: "" }, [1, 2, 3].map(i => ({
  sku: `FISCAL-${i}`, description: `Pair ${i}`, unit: "PR", quantity_pairs: 1, allocation_weight: 1, source_current: true,
  ncm: "64022000", origin: 0, cest: "" })));
const invoice = () => ({ tipo: 1, situacao: 1, numero: "existing-number", dataOperacao: "2026-10-17 12:00:00", naturezaOperacao: { id: 10 },
  valorNota: 55.94, valorFrete: 0, contato: { nome: "Test", numeroDocumento: input.document, endereco: { uf: "MG" } },
  transporte: { fretePorConta: 0 }, itens: [{ codigo: "KIT", unidade: "UN", quantidade: 1, valor: 55.94 }] });
describe("safe fiscal decomposition of an existing untransmitted draft", () => {
  it("preserves number, recipient and totals, without product or stock references", () => {
    const body = blingFiscalDraftBody(invoice(), items, commercial, input);
    expect(body.numero).toBe("existing-number");
    expect(body.itens.map(i => i.valor)).toEqual([18.65, 18.65, 18.64]);
    expect(body.itens.every(i => i.unidade === "PR")).toBe(true);
    expect(body.itens.every(i => !("produto" in i))).toBe(true);
    expect(body.itens.every(i => i.informacoesAdicionais === "SKU comercial: KIT")).toBe(true);
  });
  it.each([2, 3, 4, 5, 6, 8])("never edits fiscal situation %s", situacao => {
    expect(() => blingFiscalDraftBody({ ...invoice(), situacao }, items, commercial, input)).toThrow();
  });
  it("blocks duplicate or modified commercial draft lines", () => {
    const value = invoice(); value.itens.push({ ...value.itens[0]! });
    expect(() => blingFiscalDraftBody(value, items, commercial, input)).toThrow("invoice_draft_decomposition_conflict");
    expect(() => blingFiscalDraftBody({ ...invoice(), valorNota: 56 }, items, commercial, input)).toThrow();
  });
  it("never edits with unverified provider stock automation; replay of the exact decomposition is read-only", async () => {
    const request = vi.fn().mockResolvedValue({ data: invoice() });
    const provider = { request } as unknown as BlingClient;
    await expect(prepareBlingFiscalDraft(provider, 1, items, commercial, input, false)).rejects.toThrow("invoice_stock_automation_must_be_disabled");
    const body = blingFiscalDraftBody(invoice(), items, commercial, input);
    request.mockResolvedValue({ data: { ...invoice(), itens: body.itens } });
    await prepareBlingFiscalDraft(provider, 1, items, commercial, input, false);
    expect(request.mock.calls.every(call => call.length === 1)).toBe(true);
  });
  it("updates once and re-reads before allowing transmission", async () => {
    const body = blingFiscalDraftBody(invoice(), items, commercial, input);
    const request = vi.fn().mockResolvedValueOnce({ data: invoice() }).mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: { ...invoice(), itens: body.itens } });
    await prepareBlingFiscalDraft({ request } as unknown as BlingClient, 1, items, commercial, input, true, async () => true);
    expect(request.mock.calls.map(c => (c[1] as { method?: string } | undefined)?.method ?? "GET")).toEqual(["GET", "PUT", "GET"]);
  });
});
