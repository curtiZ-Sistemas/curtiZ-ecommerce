import { BlingError } from "@curtiz/integrations";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const request = vi.hoisted(() => vi.fn());
const invoiceDocument = vi.hoisted(() => vi.fn());
const mfa = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/internal-mfa", () => ({ hasRequiredInternalMfa: mfa }));
vi.mock("@/lib/bling-server", () => ({ panelBlingClient: () => ({ request, invoiceDocument }) }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "operator" } }, error: null }) }, rpc
  }),
  createServiceSupabaseClient: () => ({})
}));
import { GET } from "./route";

const orderId = "10000000-0000-4000-8000-000000000001";
const key = "31261112345678000195550030000000011123456782";
const row = { orderId, invoiceAuthorized: true, invoiceId: 301, invoiceKey: key, invoiceNumber: "1" };
const get = (query = `orderId=${orderId}`) =>
  GET(new NextRequest(`https://panel.example/api/operations/representative-kits/invoice-pdf?${query}`));
const pdf = new TextEncoder().encode("%PDF-1.7 teste").buffer;

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: [row], error: null });
  request.mockReset().mockResolvedValue({ data: { situacao: 5, chaveAcesso: key } });
  invoiceDocument.mockReset().mockResolvedValue(pdf);
  mfa.mockReset().mockResolvedValue(true);
});

describe("PDF da DANFE dos kits", () => {
  it("nega o acesso sem a permissão da fila fiscal ou sem MFA e não consulta o Bling", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect((await get()).status).toBe(403);
    mfa.mockResolvedValueOnce(false);
    expect((await get()).status).toBe(403);
    expect(request).not.toHaveBeenCalled();
    expect((await get("orderId=invalido")).status).toBe(400);
  });

  it("devolve o PDF inline ou como anexo, sem expor tokens", async () => {
    const inline = await get();
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-type")).toBe("application/pdf");
    expect(inline.headers.get("content-disposition")).toBe("inline; filename=\"danfe-1.pdf\"");
    expect(inline.headers.get("cache-control")).toBe("private, no-store");
    expect(new TextDecoder().decode(await inline.arrayBuffer())).toContain("%PDF-");
    expect(request).toHaveBeenCalledWith("/nfe/301");
    expect(invoiceDocument).toHaveBeenCalledWith(key, "pdf");
    expect((await get(`orderId=${orderId}&download=1`)).headers.get("content-disposition"))
      .toBe("attachment; filename=\"danfe-1.pdf\"");
  });

  it("responde 404 quando a nota não está autorizada ou o Bling não devolve o PDF", async () => {
    rpc.mockResolvedValueOnce({ data: [{ ...row, invoiceAuthorized: false }], error: null });
    expect((await get()).status).toBe(404);
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect((await get()).status).toBe(404);
    request.mockResolvedValueOnce({ data: { situacao: 5, chaveAcesso: "0".repeat(44) } });
    expect((await get()).status).toBe(404);
    invoiceDocument.mockRejectedValueOnce(new BlingError("invalid_document", 502));
    const missing = await get();
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ message: "PDF indisponível no Bling." });
  });
});
