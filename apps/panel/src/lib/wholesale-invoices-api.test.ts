import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  rpc: vi.fn(), mfa: true, origin: true, budget: true, user: true, service: true, configured: true, issue: vi.fn(), cancel: vi.fn(), steps: [] as string[]
}));
vi.mock("server-only", () => ({}));
vi.mock("@curtiz/security", () => ({
  readBoundedJson: async (request: Request) => await request.json() as unknown,
  RequestBodyError: class extends Error { status = 400; }
}));
vi.mock("@/lib/api-rate-limit", () => ({ consumePanelMutationBudget: () => state.budget }));
vi.mock("@/lib/internal-mfa", () => ({ hasRequiredInternalMfa: async () => state.mfa }));
vi.mock("@/lib/technical-api", () => ({ safeTechnicalOrigin: () => state.origin, technicalNoStore: { "cache-control": "private, no-store" } }));
vi.mock("@/lib/bling-server", () => ({ blingConfigured: () => state.configured, panelBlingClient: () => ({}) }));
vi.mock("@/lib/bling-invoice-pdf", () => ({ authorizedInvoicePdfResponse: vi.fn() }));
vi.mock("@/lib/wholesale-kit-invoice", () => ({ issueWholesaleKitInvoice: state.issue, cancelWholesaleKitInvoice: state.cancel }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user ? { id: "accountant" } : null }, error: null }) }, rpc: state.rpc }),
  createServiceSupabaseClient: () => state.service ? { service: true } : null
}));
import { GET, POST } from "../app/api/fiscal/wholesale-invoices/route";

const ids = { key: "11111111-1111-4111-8111-111111111111", kit: "22222222-2222-4222-8222-222222222222", invoice: "33333333-3333-4333-8333-333333333333" };
const buyer = (overrides: Record<string, unknown> = {}, state_ = "MG") => ({
  document: "11222333000181", name: "Loja Teste LTDA", regime: "simples", registration: "0012345678900", ...overrides,
  address: { state: state_, postal_code: "30110100", street: "Rua Teste", number: "10", district: "Centro", city: "Belo Horizonte", complement: "" }
});
const create = (overrides: Record<string, unknown> = {}) => ({
  action: "create", key: ids.key, kitId: ids.kit, template: "standard", quantity: 2, unitPriceInCents: 36001, paymentMethod: "pix",
  buyer: buyer(), ...overrides
});
const post = (body: unknown) => POST(new NextRequest("https://panel.example/api/fiscal/wholesale-invoices", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }
}));
const summary = { id: ids.invoice, status: "draft", stage: "pending", totalInCents: 72002 };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { mfa: true, origin: true, budget: true, user: true, service: true, configured: true });
  state.rpc.mockResolvedValue({ data: summary, error: null });
  state.cancel.mockResolvedValue(true);
  state.issue.mockImplementation(async (input: { onStep?: (step: string) => void }) => {
    input.onStep?.("contact"); input.onStep?.("sale");
    return { status: "authorized" };
  });
});

describe("notas de atacado: leitura", () => {
  it("nega sem sessão com MFA e devolve kits e notas para quem tem a permissão", async () => {
    state.mfa = false;
    expect((await GET()).status).toBe(403);
    state.mfa = true;
    state.rpc.mockImplementation(async (name: string) => ({ data: name === "list_wholesale_kit_offers" ? [{ kitId: ids.kit }] : [summary], error: null }));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ offers: [{ kitId: ids.kit }], invoices: [summary] });
  });

  it("devolve 403 quando o banco recusa a permissão", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    expect((await GET()).status).toBe(403);
  });
});

describe("notas de atacado: criar", () => {
  it("cria pela função protegida com a chave de idempotência e sem enviar nada ao Bling", async () => {
    const response = await post(create());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ invoice: summary });
    expect(state.rpc).toHaveBeenCalledWith("create_wholesale_kit_invoice", expect.objectContaining({
      p_key: ids.key, p_kit: ids.kit, p_template: "standard", p_quantity: 2, p_unit_price_cents: 36001, p_payment_method: "pix"
    }));
    expect(state.issue).not.toHaveBeenCalled();
  });

  it("cria uma nota com vários kits por uma única RPC", async () => {
    const items = [{ kitId: ids.kit, template: "standard", quantity: 1, unitPriceInCents: 36001 },
      { kitId: ids.invoice, template: "upper_restock", quantity: 2, unitPriceInCents: 37001 }];
    const body = { action: "create_batch", key: ids.key, paymentMethod: "pix", buyer: buyer(), items };
    expect((await post(body)).status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("create_wholesale_kit_invoice_batch", {
      p_key: ids.key, p_payment_method: "pix", p_buyer: buyer(), p_items: items
    });
    state.rpc.mockClear();
    expect((await post({ ...body, items: [items[0], items[0]] })).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("repetir a mesma chave volta a mesma nota", async () => {
    await post(create());
    await post(create());
    const keys = state.rpc.mock.calls.map(call => (call[1] as { p_key: string }).p_key);
    expect(keys).toEqual([ids.key, ids.key]);
  });

  it("não reserva estoque para regime não homologado", async () => {
    for (const regime of ["normal", "mei", "pf"]) {
      expect((await post(create({ buyer: buyer({ regime }) }))).status).toBe(422);
    }
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("recusa CNPJ inválido e empresa fora de MG antes de tocar no banco", async () => {
    const invalid = await post(create({ buyer: buyer({ document: "11222333000182" }) }));
    expect(invalid.status).toBe(422);
    expect(((await invalid.json()) as { code: string }).code).toBe("cnpj_invalid");
    const outside = await post(create({ buyer: buyer({}, "SP") }));
    expect(outside.status).toBe(422);
    expect(((await outside.json()) as { code: string }).code).toBe("buyer_outside_mg");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("recusa IE vazia, incompleta e isenta sem regra fiscal aprovada", async () => {
    expect((await post(create({ buyer: buyer({ registration: "" }) }))).status).toBe(400);
    expect((await post(create({ buyer: buyer({ registration: "123" }) }))).status).toBe(400);
    const exempt = await post(create({ buyer: buyer({ registration: "Isenta" }) }));
    expect(exempt.status).toBe(422);
    const body = await exempt.json() as { code: string; message: string };
    expect(body.code).toBe("exempt_fiscal_rule_required");
    expect(body.message).toContain("Para revenda");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("recusa campos extras, quantidade fora do limite e preço absurdo", async () => {
    expect((await post(create({ extra: true }))).status).toBe(400);
    expect((await post(create({ quantity: 100 }))).status).toBe(400);
    expect((await post(create({ unitPriceInCents: 5 }))).status).toBe(400);
    expect((await post(create({ buyer: { ...buyer(), cfop: "5102" } }))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("explica a falta de estoque e a regra fiscal ausente sem mostrar texto do banco", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "kit_grade_out_of_stock" } });
    const stock = await post(create());
    expect(stock.status).toBe(409);
    expect(((await stock.json()) as { message: string }).message).toBe("Não há fichas suficientes deste kit em estoque.");
    state.rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "resale_not_homologated" } });
    expect((await post(create())).status).toBe(409);
    state.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation private.x does not exist" } });
    const unknown = await post(create());
    expect(unknown.status).toBe(503);
    expect(JSON.stringify(await unknown.json())).not.toContain("private.x");
  });

  it("exige origem, MFA, orçamento e permissão", async () => {
    state.origin = false;
    expect((await post(create())).status).toBe(403);
    state.origin = true; state.mfa = false;
    expect((await post(create())).status).toBe(403);
    state.mfa = true; state.budget = false;
    expect((await post(create())).status).toBe(429);
    state.budget = true;
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    expect((await post(create())).status).toBe(403);
  });
});

const lines = async (response: Response) => (await response.text()).trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);

describe("notas de atacado: emitir, tentar de novo e cancelar", () => {
  it("emite em etapas e devolve a nota atualizada", async () => {
    state.rpc.mockImplementation(async (name: string) => name === "request_wholesale_kit_invoice_retry" ? { data: true, error: null }
      : { data: [{ ...summary, status: "authorized", authorized: true }], error: null });
    const response = await post({ action: "issue", id: ids.invoice });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const events = await lines(response);
    expect(events.slice(0, 2)).toEqual([{ type: "step", step: "contact" }, { type: "step", step: "sale" }]);
    expect(events.at(-1)).toMatchObject({ type: "result", status: "authorized", invoice: { status: "authorized" } });
    expect(state.issue).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: ids.invoice }));
  });

  it("mostra o motivo quando o Bling falha e deixa tentar de novo", async () => {
    state.issue.mockResolvedValue({ status: "error", code: "validation_error" });
    state.rpc.mockImplementation(async (name: string) => name === "request_wholesale_kit_invoice_retry" ? { data: true, error: null } : { data: [], error: null });
    const events = await lines(await post({ action: "issue", id: ids.invoice }));
    expect(events.at(-1)).toMatchObject({ type: "result", status: "error", code: "validation_error" });
  });

  it("uma falha inesperada vira resultado de erro, nunca texto do servidor", async () => {
    state.issue.mockRejectedValue(new Error("secret provider text"));
    state.rpc.mockResolvedValue({ data: true, error: null });
    const text = await (await post({ action: "issue", id: ids.invoice })).text();
    expect(text).not.toContain("secret provider text");
    expect(JSON.parse(text.trim().split("\n").at(-1) ?? "{}")).toMatchObject({ status: "error", code: "unexpected_error" });
  });

  it("não emite duas vezes: uma nota em andamento ou já autorizada responde 409 sem chamar o Bling", async () => {
    state.rpc.mockResolvedValue({ data: false, error: null });
    expect((await post({ action: "issue", id: ids.invoice })).status).toBe(409);
    expect(state.issue).not.toHaveBeenCalled();
  });

  it("sem Bling configurado ou sem a chave de serviço não tenta emitir", async () => {
    state.configured = false;
    expect((await post({ action: "issue", id: ids.invoice })).status).toBe(503);
    state.configured = true; state.service = false;
    expect((await post({ action: "issue", id: ids.invoice })).status).toBe(503);
    expect(state.issue).not.toHaveBeenCalled();
  });

  it("cancela localmente ou concilia no Bling pelo painel", async () => {
    state.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await (await post({ action: "cancel", id: ids.invoice })).json()).toEqual({ ok: true });
    expect(state.cancel).not.toHaveBeenCalled();
    state.rpc.mockImplementation(async (name: string) => ({ data: name === "begin_wholesale_kit_invoice_cancel" ? { wholesaleId: ids.invoice } : { ok: false }, error: null }));
    expect(await (await post({ action: "cancel", id: ids.invoice })).json()).toEqual({ ok: true });
    expect(state.cancel).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: ids.invoice, afterBlingReview: true }));
    state.cancel.mockResolvedValue(false);
    expect((await post({ action: "cancel", id: ids.invoice })).status).toBe(409);
    state.rpc.mockResolvedValue({ data: null, error: null });
    expect((await post({ action: "cancel", id: ids.invoice })).status).toBe(409);
  });
  it("encaminha a conferência após revisão e informa que o rascunho ainda existe", async () => {
    state.rpc.mockImplementation(async (name: string) => ({ data: name === "begin_wholesale_kit_invoice_cancel"
      ? { wholesaleId: ids.invoice, invoiceId: 77 } : { ok: false }, error: null }));
    state.cancel.mockImplementation(async ({ onBlocked }: { onBlocked: (reason: string) => void }) => {
      onBlocked("draft_still_present");
      return false;
    });
    const response = await post({ action: "cancel", id: ids.invoice, afterBlingReview: true });
    expect(response.status).toBe(409);
    expect(state.cancel).toHaveBeenCalledWith(expect.objectContaining({ afterBlingReview: true }));
    const body = await response.json() as { reason: string; message: string };
    expect(body.reason).toBe("draft_still_present");
    expect(body.message).toContain("rascunho ainda existe no Bling");
  });
});


describe("histórico de clientes de atacado", () => {
  it("busca apenas pela RPC protegida e não cria nem transmite nota", async () => {
    state.rpc.mockResolvedValue({ data: [{ id: ids.invoice, name: "Loja Teste" }], error: null });
    const response = await post({ action: "search_clients", query: "Loja" });
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("search_wholesale_invoice_clients", { p_query: "Loja", p_invoice_id: null });
    expect(state.issue).not.toHaveBeenCalled();
  });
  it("carrega o cliente selecionado sem retornar dados fiscais dos itens anteriores", async () => {
    state.rpc.mockResolvedValue({ data: { buyer: buyer(), selections: [{ kitId: ids.kit, template: "standard", quantity: 1, gradeLines: [] }] }, error: null });
    const response = await post({ action: "reuse_client", id: ids.invoice });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ buyer: buyer(), selections: [{ kitId: ids.kit, template: "standard", quantity: 1 }] });
  });
  it("nega pesquisa sem MFA e não permite consulta vazia", async () => {
    state.mfa = false;
    expect((await post({ action: "search_clients", query: "Loja" })).status).toBe(403);
    state.mfa = true;
    expect((await post({ action: "search_clients", query: " " })).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});


it("encaminha a confirmação explícita da revisão para transmissão", async () => {
  state.rpc.mockImplementation(async (name: string) => ({ data: name === "request_wholesale_kit_invoice_retry" ? true : [], error: null }));
  const response = await post({ action: "issue", id: ids.invoice, reviewedHash: "a".repeat(64) });
  expect(response.status).toBe(200);
  await lines(response);
  expect(state.issue).toHaveBeenCalledWith(expect.objectContaining({ reviewedHash: "a".repeat(64) }));
});
