import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>(), log: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: state.rpc }) }));
vi.mock("@curtiz/security", () => ({ logServerEvent: state.log }));
import { runTransactionalEmailJobs, emailOrderFromSource } from "./transactional-email-jobs";
const environment = { SUPABASE_URL: "https://test.supabase.co", SUPABASE_SECRET_KEY: "test-only-key", EMAIL_PROVIDER: "resend",
  EMAIL_ENABLED: "true", RESEND_API_KEY: "test-provider-key", EMAIL_FROM: "pedidos@example.com", NEXT_PUBLIC_STORE_URL: "https://store.example.com" };
const source = { order: { public_code: "CZT-TEST", customer_name_snapshot: "Pessoa Teste", customer_email_snapshot: "buyer@example.com",
  subtotal: 100, discount_total: 0, shipping_total: 15, fee_total: 0, grand_total: 115, shipping_address_snapshot: { city: "São Paulo", state: "SP" } },
  items: [{ product_name_snapshot: "Sandália", color_snapshot: "Vinho", size_snapshot: "37", quantity: 2, unit_price: 50, total: 100 }] };
let kind = "purchase_confirmed";
let providerId: string | null = null;
let eligible = true;
let begin = true;
let savedPayload: unknown = null;
let claimAvailable = true;
beforeEach(() => {
  vi.clearAllMocks(); kind = "purchase_confirmed"; providerId = null; eligible = true; begin = true; savedPayload = null; claimAvailable = true;
  state.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_transactional_email") {
      if (!claimAvailable) return { data: null, error: null };
      claimAvailable = false;
      return { data: { id: "job-test", messageId: "message-test", kind, providerId, payload: savedPayload }, error: null };
    }
    if (name === "read_transactional_email_source") return { data: eligible ? source : null, error: null };
    if (name === "begin_transactional_email") {
      savedPayload ??= args.p_payload;
      return { data: begin ? { payload: savedPayload, idempotencyKey: "resend:order-test" } : null, error: null };
    }
    return { data: true, error: null };
  });
});
const accepted = () => vi.fn<typeof fetch>().mockResolvedValue(new Response('{"id":"provider-test"}'));
describe("scheduled transactional email orchestration", () => {
  it.each(["purchase_confirmed", "review_requested"])("processes eligible persisted %s under a database lease", async (value) => {
    kind = value;
    const transport = accepted();
    expect(await runTransactionalEmailJobs(environment, "execution", 4, transport)).toMatchObject({ ok: true, processed: 1 });
    expect(transport).toHaveBeenCalledOnce();
    expect(state.rpc).toHaveBeenCalledWith("finish_transactional_email", expect.objectContaining({ p_outcome: "accepted", p_provider_id: "provider-test" }));
  });
  it.each(["pending", "cancelled", "refunded", "not_delivered", "already_reviewed"])("does not send when database eligibility rejects %s", async () => {
    eligible = false;
    const transport = accepted();
    await runTransactionalEmailJobs(environment, "execution", 1, transport);
    expect(transport).not.toHaveBeenCalled();
    expect(state.rpc).toHaveBeenCalledWith("finish_transactional_email", expect.objectContaining({ p_outcome: "cancelled" }));
  });
  it("rechecks eligibility before dispatch and stops on revoked lease/window", async () => {
    begin = false;
    const transport = accepted();
    await runTransactionalEmailJobs(environment, "execution", 1, transport);
    expect(transport).not.toHaveBeenCalled();
  });
  it("uses runtime bindings even if build environment disables mail", async () => {
    vi.stubEnv("EMAIL_ENABLED", "false");
    try {
      expect(await runTransactionalEmailJobs(environment, "execution", 1, accepted())).toMatchObject({ processed: 1 });
    } finally { vi.unstubAllEnvs(); }
  });
  it.each([{ EMAIL_ENABLED: "false" }, { RESEND_API_KEY: "" }, { EMAIL_FROM: "" }, { EMAIL_PROVIDER: "disabled" }])("records disabled/incomplete runtime without calling provider: %j", async (override) => {
    const transport = accepted();
    await runTransactionalEmailJobs({ ...environment, ...override }, "execution", 1, transport);
    expect(transport).not.toHaveBeenCalled();
    expect(state.rpc.mock.calls.map(([name]) => name)).toEqual(["sync_transactional_email_runtime"]);
  });
  it("does no work without service database credentials", async () => {
    await runTransactionalEmailJobs({ ...environment, SUPABASE_SECRET_KEY: "" }, "execution");
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("two Worker executions respect the same persisted claim", async () => {
    const transport = accepted();
    const results = await Promise.all([runTransactionalEmailJobs(environment, "one", 1, transport), runTransactionalEmailJobs(environment, "two", 1, transport)]);
    expect(results.reduce((sum, result) => sum + result.processed, 0)).toBe(1);
    expect(transport).toHaveBeenCalledOnce();
  });
  it("freezes payload across timeout retries and configuration changes", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("timeout")).mockResolvedValue(new Response('{"id":"provider-test"}'));
    await runTransactionalEmailJobs(environment, "one", 1, transport);
    expect(state.rpc).toHaveBeenCalledWith("finish_transactional_email", expect.objectContaining({ p_outcome: "uncertain" }));
    claimAvailable = true;
    await runTransactionalEmailJobs({ ...environment, EMAIL_FROM: "changed@example.com" }, "two", 1, transport);
    expect(transport.mock.calls[0]?.[1]?.body).toBe(transport.mock.calls[1]?.[1]?.body);
    expect(transport.mock.calls[0]?.[1]?.headers).toEqual(transport.mock.calls[1]?.[1]?.headers);
  });
  it("receipt persistence failures are uncertain and never logged with customer content", async () => {
    const original = state.rpc.getMockImplementation();
    state.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "finish_transactional_email" && args.p_outcome === "accepted") return { data: null, error: { message: "sensitive provider body" } };
      return original ? original(name, args) : { data: null, error: null };
    });
    expect(await runTransactionalEmailJobs(environment, "execution", 1, accepted())).toMatchObject({ failed: 1 });
    expect(state.rpc).toHaveBeenCalledWith("finish_transactional_email", expect.objectContaining({ p_outcome: "uncertain" }));
    expect(JSON.stringify(state.log.mock.calls)).not.toMatch(/buyer@|Pessoa Teste|sensitive provider body|test-provider-key/u);
  });
  it("polls provider receipts separately from send acceptance", async () => {
    providerId = "provider-test";
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"id":"provider-test","last_event":"delivered"}'));
    await runTransactionalEmailJobs(environment, "execution", 1, transport);
    expect(transport.mock.calls[0]?.[1]?.method).toBe("GET");
    expect(state.rpc).toHaveBeenCalledWith("finish_transactional_email", expect.objectContaining({ p_outcome: "observed", p_last_event: "delivered" }));
  });
  it("does not turn missing/invalid money or recipients into fabricated order data", () => {
    expect(emailOrderFromSource(source).total).toBe(115);
    expect(() => emailOrderFromSource({ ...source, order: { ...source.order, grand_total: null } })).toThrow("invalid_order_snapshot");
    expect(() => emailOrderFromSource({ ...source, order: { ...source.order, customer_email_snapshot: "invalid" } })).toThrow("invalid_order_recipient");
  });
  it("records suppression as delivery failure without posting another email", async () => {
    providerId = "provider-test";
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"id":"provider-test","last_event":"suppressed"}'));
    await runTransactionalEmailJobs(environment, "execution", 1, transport);
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[1]?.method).toBe("GET");
    expect(state.rpc).toHaveBeenCalledWith("finish_transactional_email", expect.objectContaining({
      p_outcome: "observed", p_last_event: "suppressed", p_error_code: "email_delivery_failed"
    }));
  });
});
