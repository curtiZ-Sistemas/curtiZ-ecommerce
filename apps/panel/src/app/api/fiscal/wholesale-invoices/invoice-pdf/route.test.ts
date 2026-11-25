import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), pdf: vi.fn(), mfa: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/internal-mfa", () => ({ hasRequiredInternalMfa: async () => state.mfa }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "accountant" } }, error: null }) }, rpc: state.rpc
}) }));
vi.mock("@/lib/bling-invoice-pdf", () => ({ authorizedInvoicePdfResponse: state.pdf }));
import { GET } from "./route";
const id = "33333333-3333-4333-8333-333333333333";
const key = "3".repeat(44);
const get = (suffix = "") => GET(new NextRequest(`https://panel.example/api/fiscal/wholesale-invoices/invoice-pdf?id=${id}${suffix}`));
beforeEach(() => {
  vi.clearAllMocks(); state.mfa = true;
  state.rpc.mockResolvedValue({ data: { invoiceId: 77, invoiceKey: key, invoiceNumber: "000000003" }, error: null });
  state.pdf.mockResolvedValue(new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }));
});
describe("documento de atacado", () => {
  it("resolve a referência registrada e exige a chave exata na consulta do Bling", async () => {
    expect((await get()).status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("read_wholesale_invoice_pdf_reference", { p_id: id });
    expect(state.pdf).toHaveBeenCalledWith({ invoiceId: 77, expectedKey: key, invoiceNumber: "000000003", download: false });
    await get("&download=1");
    expect(state.pdf).toHaveBeenLastCalledWith(expect.objectContaining({ download: true }));
  });
  it("nega notas sem referência, sem chave ou sem acesso", async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await get()).status).toBe(404);
    state.rpc.mockResolvedValueOnce({ data: { invoiceId: 77, invoiceKey: "" }, error: null });
    expect((await get()).status).toBe(404);
    state.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect((await get()).status).toBe(403);
    state.mfa = false;
    expect((await get()).status).toBe(403);
    expect(state.pdf).not.toHaveBeenCalled();
  });
});
