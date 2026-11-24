import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const request = vi.hoisted(() => vi.fn());
const invoiceDocument = vi.hoisted(() => vi.fn());
const authorize = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/bling-server", () => ({
  authorizeBlingPanelRequest: authorize, panelBlingClient: () => ({ request, invoiceDocument })
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: () => ({}) }));
import { GET } from "./route";

const orderId = "10000000-0000-4000-8000-000000000002";
const key = "31261112345678000195550030000000021123456782";
const get = (query = `orderId=${orderId}`) =>
  GET(new NextRequest(`https://panel.example/api/integrations/bling/orders/invoice-pdf?${query}`));

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: [{ orderId, invoiceId: 77, invoiceStatus: "authorized" }], error: null });
  authorize.mockReset().mockResolvedValue({ rpc });
  request.mockReset().mockResolvedValue({ data: { situacao: 6, chaveAcesso: key } });
  invoiceDocument.mockReset().mockResolvedValue(new TextEncoder().encode("%PDF-1.7").buffer);
});

describe("PDF da DANFE dos pedidos da loja", () => {
  it("nega acesso sem papel de painel", async () => {
    authorize.mockResolvedValueOnce(null);
    expect((await get()).status).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });

  it("devolve o PDF da nota autorizada e 404 para nota não autorizada", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(request).toHaveBeenCalledWith("/nfe/77");
    rpc.mockResolvedValueOnce({ data: [{ orderId, invoiceId: 77, invoiceStatus: "processing" }], error: null });
    expect((await get()).status).toBe(404);
  });
});
