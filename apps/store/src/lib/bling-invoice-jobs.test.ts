import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Integrations from "@curtiz/integrations";
const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), request: vi.fn(),
  status: "processing", payment: "approved", approved: true, changed: false, situation: 1,
  jobType: "bling.invoice.send", writable: true, uncertain: false }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: state.rpc, from: state.from }) }));
vi.mock("@curtiz/security", () => ({ logServerEvent: vi.fn() }));
vi.mock("@curtiz/security/pii", () => ({ decryptPII: () => "12345678909" }));
vi.mock("@curtiz/integrations", async importOriginal => ({ ...await importOriginal<typeof Integrations>(),
  createBlingClient: () => ({ request: state.request }) }));
import { BlingError } from "@curtiz/integrations";
import { runBlingJobs } from "./bling-jobs";

// In-memory boundary fixtures only; no payment, approval or provider record is
// written in a real environment by these orchestration regression tests.
const orderId = "ba200000-0000-4000-8000-000000000010";
const environment = { SUPABASE_URL: "https://test.supabase.co", SUPABASE_SECRET_KEY: "test-only-service",
  BLING_CLIENT_ID: "test-only-client", BLING_CLIENT_SECRET: "test-only-secret", BLING_TOKEN_ENCRYPTION_KEY: "test-only-key",
  BLING_FISCAL_READY: "true", BLING_INVOICE_SYNC_ENABLED: "true", BLING_INVOICE_SEND_ENABLED: "true",
  BLING_INVOICE_TRANSMISSION_MODE: "homologation", BLING_INVOICE_STOCK_AUTOMATION_DISABLED: "true" };
const rules = [{ scenario: "sale_in_state", issuer_state: "MG", cfop: "5102", csosn: "102", icms_rate: 0,
  document_model: 55, series: 2, pis_cst: "49", cofins_cst: "49", ipi_cst: "99", pis_rate: 0,
  cofins_rate: 0, ipi_rate: 0, ipi_cenq: "999", natures: [{ final_consumer: true, external_nature_id: 10 }] }];
const item = { variant_id: "variant-test", sku_snapshot: "KIT-TEST", product_name_snapshot: "Test kit", quantity: 1, unit_price: 43.45 };
const snapshot = { variant: { id: item.variant_id, sku: item.sku_snapshot }, metadata: { commercial_unit: "UN",
  pairs_per_sku: 2, fiscal_unit_approved: true, ncm: "64022000", origin: 0, cest: "" },
  kit_components: [1, 2].map(i => ({ sku: `TEST-PAIR-${i}`, description: `Test pair ${i}`, unit: "PR", quantity_pairs: 1,
    allocation_weight: 1, ncm: "64022000", origin: 0, cest: "", source_current: true })) };
const invoice = () => ({ situacao: state.situation, numeroPedidoLoja: "CZ-TEST", naturezaOperacao: { id: 10 }, serie: 2,
  valorNota: 43.45, valorFrete: 0, numero: "1", contato: { numeroDocumento: "12345678909", endereco: { uf: "MG", cep: "30000000" } },
  itens: [21.73, 21.72].map((valor, i) => ({ codigo: `TEST-PAIR-${i + 1}`, unidade: "PR", quantidade: 1, valor,
    classificacaoFiscal: "64022000", origem: 0, cest: "", cfop: "5102" })) });
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { status: "processing", payment: "approved", approved: true, changed: false, situation: 1,
    jobType: "bling.invoice.send", writable: true, uncertain: false });
  let claimed = false;
  state.rpc.mockImplementation(async (name: string) => ({ error: null, data:
    name === "read_integration_credential" ? { status: "connected" }
      : name === "claim_bling_job" ? claimed ? null : (claimed = true, { id: "job-test", jobType: state.jobType, payload: { orderId } })
        : name === "read_bling_order_link" ? { external_order_id: 88, invoice_id: 99, erp_status: "synced" }
          : name === "read_bling_account" ? { companyId: "company-test" }
            : name === "read_bling_fiscal_mirror_approval" ? null
              : name === "read_bling_fiscal_automation_context" ? { configurationHash: "a".repeat(64), policyApproved: state.approved,
                recipient: { icms_taxpayer: false, final_consumer: true } }
                : name === "read_bling_fiscal_rules" ? rules
                  : name === "read_bling_catalog_variant" ? snapshot
                    : name === "read_bling_product_links" ? [{ variantId: item.variant_id, externalProductId: 101, commercialUnit: "UN" }]
                      : name === "save_bling_automatic_mirror_approval" ? !state.changed
                        : name === "assert_bling_order_writable" ? state.writable : true }));
  state.from.mockImplementation((table: string) => ({ select: () => ({ eq: () => ({
    data: table === "order_items" ? [item] : null, error: null,
    maybeSingle: async () => ({ error: null, data: { id: orderId, payment_status: state.payment, status: state.status,
      cpf_ciphertext: "test-only-encrypted-document", shipping_address_snapshot: { state: "MG", postal_code: "30000000" },
      grand_total: 43.45, shipping_total: 0, discount_total: 0, fee_total: 0 } })
  }) }) }));
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith("/enviar?enviarEmail=false")) {
      if (state.uncertain) throw new BlingError("uncertain_write", 503, false, true);
      state.situation = 3; // HTTP 200 is only acceptance; authorization comes later.
      return { data: {} };
    }
    return { data: path === "/empresas/me/dados-basicos" ? { id: "company-test", cnpj: "12345678000199" }
      : path.startsWith("/naturezas-operacoes") ? [{ id: 10 }]
        : path === "/produtos/101" ? { situacao: "A", codigo: "KIT-TEST", unidade: "UN", tributacao: { ncm: "64022000", origem: 0, cest: "" } }
          : invoice() };
  });
});
const run = (flags: Record<string, string | undefined> = {}) => runBlingJobs({ ...environment, ...flags }, "test-only", 1);
const sent = () => state.request.mock.calls.filter(([path]) => String(path).includes("/enviar"));

describe("kit invoice job safety at generation and transmission", () => {
  it.each(["bling.invoice.generate", "bling.invoice.send"])("blocks %s without stock automation confirmation, including existing drafts", async jobType => {
    state.jobType = jobType;
    expect(await run({ BLING_INVOICE_STOCK_AUTOMATION_DISABLED: "false" })).toMatchObject({ failed: 1 });
    expect(state.request).not.toHaveBeenCalled();
    expect(state.rpc).toHaveBeenCalledWith("finish_bling_job", expect.objectContaining({ p_error_code: "invoice_stock_automation_must_be_disabled" }));
  });
  it("sends the exact approved kit once and records processing rather than authorization on HTTP 200", async () => {
    expect(await run()).toMatchObject({ ok: true, processed: 1 });
    expect(sent()).toHaveLength(1);
    expect(state.rpc).toHaveBeenCalledWith("observe_bling_invoice", expect.objectContaining({ p_situation: 3 }));
    expect(state.rpc).not.toHaveBeenCalledWith("observe_bling_invoice", expect.objectContaining({ p_situation: 5 }));
  });
  it.each([5, 6])("reconciles already issued situation %s without resending", async situation => {
    state.situation = situation;
    expect(await run()).toMatchObject({ ok: true, processed: 1 });
    expect(sent()).toHaveLength(0);
    expect(state.rpc).toHaveBeenCalledWith("observe_bling_invoice", expect.objectContaining({ p_situation: situation }));
  });
  it.each([2, 3, 4, 8, 9, 11])("never resends a non-sendable situation %s", async situation => {
    state.situation = situation;
    expect(await run()).toMatchObject({ failed: 1 });
    expect(sent()).toHaveLength(0);
  });
  it.each(["cancelled", "refunded", "manual_review", "refund_pending"])("blocks %s orders before fiscal provider calls", async status => {
    state.status = status;
    expect(await run()).toMatchObject({ failed: 1 });
    expect(state.request).not.toHaveBeenCalled();
  });
  it.each([
    { approved: false }, { changed: true }, { payment: "pending" }, { writable: false }
  ])("blocks missing policy, changed approval, unconfirmed payment or late cancellation: %j", async change => {
    Object.assign(state, change);
    expect(await run()).toMatchObject({ failed: 1 });
    expect(sent()).toHaveLength(0);
  });
  it("fails uncertain sends for reconciliation rather than automatic replay", async () => {
    state.uncertain = true;
    expect(await run()).toMatchObject({ failed: 1 });
    expect(sent()).toHaveLength(1);
    expect(state.rpc).toHaveBeenCalledWith("finish_bling_job", expect.objectContaining({ p_outcome: "failed", p_error_code: "uncertain_write" }));
  });
});
