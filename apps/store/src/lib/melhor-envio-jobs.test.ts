import { beforeEach, describe, expect, it, vi } from "vitest";
import { MelhorEnvioError } from "@curtiz/integrations";

const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), purchase: vi.fn(), generate: vi.fn(), getShipment: vi.fn(),
  create: vi.fn(), casLost: false, saveFailed: false }));
vi.mock("server-only", () => ({}));
vi.mock("@curtiz/security", () => ({ logServerEvent: vi.fn() }));
vi.mock("@curtiz/security/pii", () => ({ decryptPII: () => "12345678909" }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: state.rpc, from: state.from }) }));
vi.mock("./melhor-envio-server", () => ({ createMelhorEnvioProvider: () => ({ purchase: state.purchase,
  generate: state.generate, getShipment: state.getShipment, createShipment: state.create }) }));
import { runMelhorEnvioShippingJobs } from "./melhor-envio-jobs";

let shipment: Record<string, unknown>;
let order: Record<string, unknown>;
let link: Record<string, unknown>;
let jobType: string;
let quoteEnvironment: string;
const environment = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "test-only",
  MELHOR_ENVIO_ENVIRONMENT: "sandbox", MELHOR_ENVIO_LABEL_PURCHASE_ENABLED: "true", MELHOR_ENVIO_LABEL_GENERATION_ENABLED: "true" };
beforeEach(() => {
  vi.clearAllMocks();
  state.casLost = false; state.saveFailed = false;
  shipment = { id: "shipment-1", order_id: "order-1", external_id: "external-1", operation_state: "created", status: "pending", shipping_quote_id: "quote-1" };
  order = { status: "picking", payment_status: "approved" };
  link = { invoice_status: "authorized", invoice_access_key: "1".repeat(44), erp_status: "synced" };
  jobType = "melhorenvio.purchase"; quoteEnvironment = "sandbox";
  let claimed = false;
  state.rpc.mockImplementation(async (name: string) => ({ error: null, data:
    name === "claim_melhor_envio_fulfillment_job" ? claimed ? null : (claimed = true, { id: "job-1", jobType, payload: { shipmentId: "shipment-1" } })
      : name === "read_bling_order_link" ? link : name === "get_customer_checkout_identity" ? { cpfCiphertext: "test-only" }
        : name === "apply_melhor_envio_webhook" ? "processed" : true }));
  state.from.mockImplementation((table: string) => {
    let changes: Record<string, unknown> | undefined;
    const filters: Record<string, unknown> = {};
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      in: (key: string, values: unknown[]) => { filters[key] = values; return query; },
      update: (value: Record<string, unknown>) => { changes = value; return query; },
      then: (resolve: (value: unknown) => unknown) => query.maybeSingle().then(resolve),
      maybeSingle: async () => {
        if (table === "orders") return { data: order, error: null };
        if (table === "shipping_quotes") return { data: { provider_environment: quoteEnvironment, service_id: "6" }, error: null };
        if (table === "order_items") return { data: [{ variant_id: "kit-variant", product_name_snapshot: "Commercial kit", quantity: 1, unit_price: 50 }], error: null };
        if (changes) {
          const matches = Array.isArray(filters.operation_state) ? filters.operation_state.includes(shipment.operation_state) : filters.operation_state === shipment.operation_state;
          if (state.casLost || !matches) return { data: null, error: null };
          if (state.saveFailed && changes.operation_state === "purchased") return { data: null, error: { code: "unavailable" } };
          Object.assign(shipment, changes);
        }
        return { data: { ...shipment }, error: null };
      }
    };
    return query;
  });
  state.purchase.mockReset().mockResolvedValue({}); state.generate.mockReset().mockResolvedValue({});
  state.create.mockReset().mockResolvedValue({ externalId: "created-external" });
  state.getShipment.mockReset().mockResolvedValue({ status: "released", updated_at: "2026-10-17T12:00:00Z" });
});

describe("persistent shipping stages", () => {
  const creation = () => {
    jobType = "melhorenvio.create"; shipment.external_id = null; shipment.operation_state = "pending";
    shipment.package_snapshot = [{ dimensions: { height: 5, width: 10, length: 20 }, weight: 0.2 }];
    Object.assign(order, { customer_id: "owner", customer_name_snapshot: "Fixture", customer_email_snapshot: "fixture@example.invalid",
      customer_phone_snapshot: "31999999999", shipping_address_snapshot: { street: "Fixture street", number: "1", district: "Fixture", city: "Test city", state: "SP", postalCode: "01001000" } });
    return { ...environment, MELHOR_ENVIO_ORIGIN_NAME: "Fixture", MELHOR_ENVIO_ORIGIN_EMAIL: "fixture@example.invalid",
      MELHOR_ENVIO_ORIGIN_PHONE: "31999999999", MELHOR_ENVIO_ORIGIN_DOCUMENT: "12345678909", MELHOR_ENVIO_ORIGIN_ADDRESS: "Fixture street",
      MELHOR_ENVIO_ORIGIN_NUMBER: "1", MELHOR_ENVIO_ORIGIN_DISTRICT: "Fixture", MELHOR_ENVIO_ORIGIN_CITY: "Nova Serrana",
      MELHOR_ENVIO_ORIGIN_STATE: "MG", MELHOR_ENVIO_ORIGIN_POSTAL_CODE: "35519000" };
  };
  it("uses the selected service, physical origin, invoice and commercial kit without inventory writes", async () => {
    expect(await runMelhorEnvioShippingJobs(creation(), "test", 1)).toMatchObject({ processed: 1, failed: 0 });
    const input: unknown = state.create.mock.calls[0]?.[0];
    expect(input).toMatchObject({ serviceId: "6", from: { city: "Nova Serrana", state_abbr: "MG" },
      products: [{ name: "Commercial kit", quantity: 1, unitary_value: 50 }], options: { invoice: { key: "1".repeat(44) } } });
    expect(state.from).not.toHaveBeenCalledWith("inventory");
  });
  it("rejects an incomplete recipient before creating the provider cart", async () => {
    const values = creation(); order.customer_email_snapshot = "";
    expect(await runMelhorEnvioShippingJobs(values, "test", 1)).toMatchObject({ failed: 1 });
    expect(state.create).not.toHaveBeenCalled();
  });
  it("purchases once and waits for provider confirmation", async () => {
    expect(await runMelhorEnvioShippingJobs(environment, "test", 1)).toMatchObject({ processed: 1, failed: 0 });
    expect(state.purchase).toHaveBeenCalledExactlyOnceWith(["external-1"]);
    expect(shipment.operation_state).toBe("purchased");
  });
  it.each(["rejected", "pending", "cancelled"])("blocks invoice %s", async status => {
    link.invoice_status = status;
    expect(await runMelhorEnvioShippingJobs(environment, "test", 1)).toMatchObject({ failed: 1 });
    expect(state.purchase).not.toHaveBeenCalled();
  });
  it.each(["cancelled", "refund_pending", "manual_review"])("blocks order %s", async status => {
    order.status = status; await runMelhorEnvioShippingJobs(environment, "test", 1);
    expect(state.purchase).not.toHaveBeenCalled();
  });
  it("never buys in production without specific authorization", async () => {
    quoteEnvironment = "production";
    await runMelhorEnvioShippingJobs({ ...environment, MELHOR_ENVIO_ENVIRONMENT: "production" }, "test", 1);
    expect(state.purchase).not.toHaveBeenCalled();
    expect(state.rpc).toHaveBeenCalledWith("claim_melhor_envio_fulfillment_job", expect.objectContaining({ p_purchase_enabled: false, p_generation_enabled: false }));
  });
  it("blocks stale quotes and concurrent claims before any external write", async () => {
    quoteEnvironment = "production"; await runMelhorEnvioShippingJobs(environment, "test", 1);
    expect(state.purchase).not.toHaveBeenCalled();
  });
  it("does not write after losing the shipment claim", async () => {
    state.casLost = true; await runMelhorEnvioShippingJobs(environment, "test", 1);
    expect(state.purchase).not.toHaveBeenCalled();
  });
  it("does not repurchase an already purchased shipment on replay", async () => {
    shipment.operation_state = "purchased";
    await runMelhorEnvioShippingJobs(environment, "test", 1);
    expect(state.purchase).not.toHaveBeenCalled();
  });
  it.each(["provider_timeout", "lost_receipt", "pending_payment"])("holds %s for reconciliation", async issue => {
    if (issue === "provider_timeout") state.purchase.mockRejectedValue(new MelhorEnvioError("uncertain_write", 503, false));
    if (issue === "lost_receipt") state.saveFailed = true;
    if (issue === "pending_payment") state.getShipment.mockResolvedValue({ status: "pending" });
    await runMelhorEnvioShippingJobs(environment, "test", 1);
    expect(state.purchase).toHaveBeenCalledOnce();
    expect(shipment.operation_state).toBe("reconciliation_required");
    expect(state.rpc).toHaveBeenCalledWith("finish_melhor_envio_job", expect.objectContaining({ p_success: false, p_error_code: "uncertain_write" }));
  });
  it("generates only after purchase and verifies the label at the provider", async () => {
    jobType = "melhorenvio.generate"; shipment.operation_state = "purchased";
    state.getShipment.mockResolvedValue({ status: "generated" });
    await runMelhorEnvioShippingJobs(environment, "test", 1);
    expect(state.generate).toHaveBeenCalledOnce(); expect(state.purchase).not.toHaveBeenCalled();
    expect(shipment).toMatchObject({ operation_state: "generated", status: "label_created", label_path: "private:external-1" });
  });
  it("reconciles tracking through the trusted observation RPC without buying", async () => {
    jobType = "melhorenvio.sync";
    state.getShipment.mockResolvedValue({ status: "delivered", delivered_at: "2026-10-17T12:00:00Z", tracking: "TEST-TRACK" });
    await runMelhorEnvioShippingJobs(environment, "test", 1);
    expect(state.rpc).toHaveBeenCalledWith("apply_melhor_envio_webhook", expect.objectContaining({ p_status: "delivered", p_tracking_code: "TEST-TRACK" }));
    expect(state.purchase).not.toHaveBeenCalled(); expect(state.generate).not.toHaveBeenCalled();
  });
});
