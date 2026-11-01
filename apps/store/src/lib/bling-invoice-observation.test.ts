import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BlingClient } from "@curtiz/integrations";
vi.mock("server-only", () => ({}));
import { observeBlingInvoice } from "./bling-invoice-observation";

function fixture(link: unknown = { orderCode: "CZ-TEST", externalOrderId: 88, invoiceId: 99 }) {
  const rpc = vi.fn<(name: string, args?: unknown) => Promise<{ error: { code?: string } | null; data: unknown }>>(
    async (name: string) => ({ error: null, data: name === "read_bling_invoice_order" ? link : true }));
  const request = vi.fn<(path: string) => Promise<{ data: Record<string, unknown> }>>(async (path: string) => ({ data: path === "/nfe/99"
    ? { id: 99, numeroPedidoLoja: "", situacao: 5, numero: "3", chaveAcesso: "1".repeat(44) }
    : { id: 88, numeroLoja: "CZ-TEST", notaFiscal: { id: 99 } } }));
  return { rpc, request, db: { rpc } as unknown as SupabaseClient, provider: { request } as unknown as BlingClient };
}

describe("provider invoice observations", () => {
  it("recovers a missing store reference only from the exact existing invoice link", async () => {
    const f = fixture();
    expect(await observeBlingInvoice(f.db, f.provider, 99)).toBe(true);
    expect(f.rpc).toHaveBeenCalledWith("observe_bling_invoice", expect.objectContaining({ p_order_code: "CZ-TEST", p_invoice_id: 99 }));
  });
  it("ignores unrelated fiscal webhooks without creating a sale or invoice", async () => {
    const f = fixture(null);
    expect(await observeBlingInvoice(f.db, f.provider, 99, { ignoreUnrelated: true })).toBe(false);
    expect(f.rpc).not.toHaveBeenCalledWith("observe_bling_invoice", expect.anything());
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("keeps an explicit order operation failed when its invoice has no mapping", async () => {
    const f = fixture(null);
    await expect(observeBlingInvoice(f.db, f.provider, 99)).rejects.toThrow("invoice_order_unlinked");
  });
  it("does not attach an invoice solely because its store reference matches", async () => {
    const f = fixture({ orderCode: "CZ-TEST", externalOrderId: 88, invoiceId: null });
    f.request.mockResolvedValueOnce({ data: { id: 99, numeroPedidoLoja: "CZ-TEST", situacao: 1 } })
      .mockResolvedValueOnce({ data: { id: 88, numeroLoja: "CZ-TEST", notaFiscal: { id: 100 } } });
    await expect(observeBlingInvoice(f.db, f.provider, 99)).rejects.toThrow("invoice_link_conflict");
    expect(f.rpc).not.toHaveBeenCalledWith("observe_bling_invoice", expect.anything());
  });
  it("confirms the provider sale before binding a newly generated invoice", async () => {
    const f = fixture({ orderCode: "CZ-TEST", externalOrderId: 88, invoiceId: null });
    f.request.mockResolvedValueOnce({ data: { id: 99, numeroPedidoLoja: "CZ-TEST", situacao: 1 } });
    expect(await observeBlingInvoice(f.db, f.provider, 99)).toBe(true);
    expect(f.request).toHaveBeenCalledWith("/pedidos/vendas/88");
  });
  it("rejects conflicting provider references even when the invoice ID is known", async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce({ data: { id: 99, numeroPedidoLoja: "OTHER-ORDER", situacao: 5 } });
    await expect(observeBlingInvoice(f.db, f.provider, 99)).rejects.toThrow("invoice_link_conflict");
  });
  it("does not interpret a database failure as an unrelated event", async () => {
    const f = fixture(); f.rpc.mockResolvedValueOnce({ error: {}, data: null });
    await expect(observeBlingInvoice(f.db, f.provider, 99, { ignoreUnrelated: true })).rejects.toThrow("storage_unavailable");
  });
  it("keeps a database mapping conflict blocked without automatic retries", async () => {
    const f = fixture(); f.rpc.mockResolvedValueOnce({ error: { code: "23514" }, data: null });
    await expect(observeBlingInvoice(f.db, f.provider, 99)).rejects.toMatchObject({ code: "invoice_link_conflict", retryable: false });
  });
});
