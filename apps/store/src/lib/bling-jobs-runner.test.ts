import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Integrations from "@curtiz/integrations";
const state = vi.hoisted(() => ({ rpc: vi.fn(), request: vi.fn<(path: string) => Promise<{ data: unknown }>>(), from: vi.fn(), log: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: state.rpc, from: state.from }) }));
vi.mock("@curtiz/security", () => ({ logServerEvent: state.log }));
vi.mock("@curtiz/integrations", async (importOriginal) => ({ ...await importOriginal<typeof Integrations>(),
  createBlingClient: () => ({ request: state.request }) }));
import { BlingError } from "@curtiz/integrations";
import { runBlingJobs } from "./bling-jobs";

const environment = { SUPABASE_URL: "https://test.supabase.co", SUPABASE_SECRET_KEY: "test-only-service",
  BLING_CLIENT_ID: "test-only-client", BLING_CLIENT_SECRET: "test-only-secret", BLING_TOKEN_ENCRYPTION_KEY: "test-only-key" };
const orderId = "ba100000-0000-4000-8000-000000000010";
const jobId = "ba100000-0000-4000-8000-000000000011";
const order = () => ({ id: orderId, public_code: "CZ-TEST", status: "processing", payment_status: "approved", grand_total: 50 });
const external = () => ({ numeroLoja: "CZ-TEST", total: 50, itens: [{ codigo: "SKU-37", quantidade: 1, valor: 50 }], notaFiscal: { id: 99 } });
beforeEach(() => {
  vi.clearAllMocks();
  let claimed = false;
  state.rpc.mockImplementation(async (name: string) => {
    if (name === "read_integration_credential") return { data: { status: "connected" }, error: null };
    if (name === "claim_bling_job") {
      if (claimed) return { data: null, error: null };
      claimed = true;
      return { data: { id: jobId, jobType: "bling.order.reconcile", payload: { orderId }, attempts: 1 }, error: null };
    }
    if (name === "read_bling_order_link") return { data: { external_order_id: 88, erp_status: "reconciliation_required" }, error: null };
    return { data: true, error: null };
  });
  state.from.mockImplementation((table: string) => ({ select: () => ({ eq: () => ({
    data: table === "order_items" ? [{ sku_snapshot: "SKU-37", quantity: 1, unit_price: 50 }] : null,
    error: null, maybeSingle: async () => ({ data: order(), error: null })
  }) }) }));
  state.request.mockImplementation(async (path: string) => ({ data: path === "/nfe/99"
    ? { numeroPedidoLoja: "CZ-TEST", situacao: 5, numero: "1", chaveAcesso: "1".repeat(44) } : external() }));
});

describe("persistent Bling job orchestration", () => {
  it.each([{ icms_taxpayer: true, final_consumer: true }, { icms_taxpayer: false, final_consumer: false }, {}])(
    "blocks an unsupported new ERP order even with fiscalReady off: %j", async recipient => {
      state.rpc.mockImplementation(async (name: string) => ({ error: null, data:
        name === "read_integration_credential" ? { status: "connected" }
          : name === "claim_bling_job" ? { id: jobId, jobType: "bling.order.create", payload: { orderId }, attempts: 1 }
            : name === "read_bling_order_link" ? null
              : name === "read_bling_fiscal_automation_context" ? { recipient } : true }));
      expect(await runBlingJobs({ ...environment, BLING_ORDER_SYNC_ENABLED: "true" }, "execution-test", 1))
        .toMatchObject({ failed: 1 });
      expect(state.request).not.toHaveBeenCalled();
      expect(state.rpc).toHaveBeenCalledWith("finish_bling_job", expect.objectContaining({
        p_error_code: "icms_taxpayer" in recipient ? "fiscal_scenario_not_homologated" : "fiscal_recipient_required" }));
    });
  it("consults an existing sale and invoice, confirms reconciliation and completes under its lease", async () => {
    expect(await runBlingJobs(environment, "execution-test")).toMatchObject({ ok: true, processed: 1 });
    expect(state.request.mock.calls.map(([path]) => path)).toEqual(["/pedidos/vendas/88", "/nfe/99"]);
    expect(state.rpc).toHaveBeenCalledWith("confirm_bling_order_reconciliation", { p_order_id: orderId });
    expect(state.rpc).toHaveBeenCalledWith("finish_bling_job", expect.objectContaining({ p_job_id: jobId, p_lock_id: expect.any(String) as unknown, p_outcome: "completed" }));
    expect(state.request.mock.calls.every((call) => call.length === 1)).toBe(true);
  });
  it("keeps conflicting external records failed without confirming or generating another sale", async () => {
    state.request.mockResolvedValue({ data: { ...external(), total: 51 } });
    expect(await runBlingJobs(environment, "execution-test")).toMatchObject({ ok: false, processed: 0, failed: 1 });
    expect(state.rpc).not.toHaveBeenCalledWith("confirm_bling_order_reconciliation", expect.anything());
    expect(state.rpc).toHaveBeenCalledWith("finish_bling_job", expect.objectContaining({ p_outcome: "failed", p_error_code: "external_order_mismatch" }));
  });
  it("stops when the lease is lost without updating a job owned by another worker", async () => {
    state.request.mockRejectedValue(new BlingError("job_lease_lost", 409));
    expect(await runBlingJobs(environment, "execution-test")).toMatchObject({ ok: false, processed: 0, failed: 1 });
    expect(state.rpc.mock.calls.some(([name]) => name === "finish_bling_job")).toBe(false);
    expect(state.request).toHaveBeenCalledOnce();
  });
  it("leaves commerce disabled while allowing read-only reconciliation claims", async () => {
    await runBlingJobs(environment, "execution-test");
    expect(state.rpc).toHaveBeenCalledWith("claim_bling_job", expect.objectContaining({ p_order_enabled: false,
      p_invoice_enabled: false, p_send_enabled: false, p_product_enabled: false, p_create_enabled: false, p_stock_enabled: false, p_email_enabled: false }));
  });
  it("does no processing when credentials are missing or the connection is revoked", async () => {
    expect(await runBlingJobs({}, "execution-test")).toMatchObject({ ok: false, processed: 0 });
    expect(state.rpc).not.toHaveBeenCalled();
    state.rpc.mockResolvedValue({ data: { status: "refresh_required" }, error: null });
    expect(await runBlingJobs(environment, "execution-test")).toMatchObject({ ok: false, processed: 0 });
    expect(state.request).not.toHaveBeenCalled();
  });
  it.each(["bling.invoice.generate", "bling.invoice.send"])("blocks %s with its runtime gate off even if a job is erroneously claimed", async (jobType) => {
    state.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "read_integration_credential" ? { status: "connected" }
      : name === "claim_bling_job" ? { id: jobId, jobType, payload: { orderId }, attempts: 1 } : true }));
    expect(await runBlingJobs(environment, "execution-test", 1)).toMatchObject({ ok: false, failed: 1 });
    expect(state.request).not.toHaveBeenCalled();
  });
  it("requires documented approval before any fiscal provider call", async () => {
    state.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "read_integration_credential" ? { status: "connected" }
      : name === "claim_bling_job" ? { id: jobId, jobType: "bling.invoice.generate", payload: { orderId }, attempts: 1 }
        : name === "read_bling_order_link" ? { external_order_id: 88, erp_status: "synced" }
          : name === "read_bling_account" ? { companyId: "company-test" } : name === "read_bling_fiscal_mirror_approval" ? null : true }));
    expect(await runBlingJobs({ ...environment, BLING_FISCAL_READY: "true", BLING_INVOICE_SYNC_ENABLED: "true" }, "execution-test", 1))
      .toMatchObject({ ok: false, failed: 1 });
    expect(state.request).not.toHaveBeenCalled();
    expect(state.rpc.mock.calls.find(([name]) => name === "finish_bling_job")?.[1]).toMatchObject({ p_error_code: "fiscal_automation_policy_required" });
  });
  it.each([
    [{ BLING_INVOICE_SEND_ENABLED: "true" }, "invoice_environment_required"],
    [{ BLING_INVOICE_SEND_ENABLED: "true", BLING_INVOICE_TRANSMISSION_MODE: "production" }, "live_invoice_not_authorized"]
  ])("requires explicit transmission environment and authorization for real invoices", async (flags, code) => {
    state.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "read_integration_credential" ? { status: "connected" }
      : name === "claim_bling_job" ? { id: jobId, jobType: "bling.invoice.send", payload: { orderId }, attempts: 1 } : true }));
    expect(await runBlingJobs({ ...environment, ...flags }, "execution-test", 1)).toMatchObject({ failed: 1 });
    expect(state.request).not.toHaveBeenCalled();
    expect(state.rpc).toHaveBeenCalledWith("finish_bling_job", expect.objectContaining({ p_error_code: code }));
  });
  it("retries a processing invoice through read-only calls without resending it", async () => {
    state.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "read_integration_credential" ? { status: "connected" }
      : name === "claim_bling_job" ? { id: jobId, jobType: "bling.invoice.poll", payload: { orderId }, attempts: 1 }
        : name === "read_bling_order_link" ? { invoice_id: 99, invoice_status: "processing" } : true }));
    state.request.mockResolvedValue({ data: { numeroPedidoLoja: "CZ-TEST", situacao: 3 } });
    await runBlingJobs(environment, "execution-test", 1);
    expect(state.request.mock.calls).toEqual([["/nfe/99"]]);
    expect(state.rpc).toHaveBeenCalledWith("finish_bling_job", expect.objectContaining({ p_outcome: "retry", p_error_code: "invoice_processing", p_retry_after_ms: 120000 }));
  });
  it("requires reconciliation after an uncertain draft write before another generation or transmission", async () => {
    state.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "read_integration_credential" ? { status: "connected" }
      : name === "claim_bling_job" ? { id: jobId, jobType: "bling.invoice.generate", payload: { orderId }, attempts: 1 }
        : name === "read_bling_order_link" ? { external_order_id: 88, erp_status: "synced", last_error_code: "uncertain_write" } : true }));
    await runBlingJobs({ ...environment, BLING_FISCAL_READY: "true", BLING_INVOICE_SYNC_ENABLED: "true" }, "execution-test", 1);
    expect(state.request).not.toHaveBeenCalled();
    expect(state.rpc).toHaveBeenCalledWith("finish_bling_job", expect.objectContaining({ p_outcome: "failed", p_error_code: "reconciliation_required" }));
  });
});
