import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
type SessionUser = { id: string; email: string };
const state = vi.hoisted((): { user: SessionUser | null; record: ReturnType<typeof vi.fn>; rate: ReturnType<typeof vi.fn>; provider: ReturnType<typeof vi.fn> } => ({ user: { id: "actor", email: "fixture@example.invalid" },
  record: vi.fn(), rate: vi.fn(), provider: vi.fn() }));
vi.mock("@/lib/http-origin", () => import("../../../../../lib/http-origin"));
vi.mock("@/lib/private-request", () => ({ readPrivateJson: (r: Request) => r.json(),
  requirePrivateRateLimit: state.rate, PrivateRequestError: class extends Error { status = 429; } }));
vi.mock("@/lib/unknown-data", () => import("../../../../../lib/unknown-data"));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
  createServiceSupabaseClient: () => ({ rpc: vi.fn() }) }));
vi.mock("@/lib/melhor-envio-server", () => ({ resolveShippingProducts: vi.fn() }));
vi.mock("@/lib/checkout-identity", () => ({ readCustomerCheckoutCpf: vi.fn() }));
vi.mock("@/lib/representative-test-transactions", () => ({
  KitTransactionError: class extends Error { constructor(readonly status = 409) { super(); } },
  kitRecord: state.record, kitCall: vi.fn(), kitTestProvider: state.provider,
  beginKitPix: vi.fn(), cancelKitTestOrder: vi.fn(), refundKitTestOrder: vi.fn(), reconcileKitTestPayment: vi.fn()
}));
import { POST } from "./route";
const order = "10000000-0000-4000-8000-000000000001";
const send = (body: unknown, origin = "https://curtiz.com.br") => POST(new NextRequest("https://curtiz.com.br/api/representatives/kits/transactions", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body)
}));
beforeEach(() => { vi.clearAllMocks(); state.user = { id: "actor", email: "fixture@example.invalid" }; vi.stubEnv("ALLOWED_ORIGINS", "https://curtiz.com.br"); });
afterEach(() => vi.unstubAllEnvs());
describe("kit transaction access", () => {
  it("rejects cross origin before authentication or provider work", async () => {
    expect((await send({ action: "read", orderId: order }, "https://attacker.invalid")).status).toBe(403);
    expect(state.provider).not.toHaveBeenCalled();
  });
  it("requires a verified session", async () => {
    state.user = null;
    expect((await send({ action: "read", orderId: order })).status).toBe(401);
    expect(state.record).not.toHaveBeenCalled();
  });
  it("does not accept actor, prices or mode from JSON", async () => {
    expect((await send({ action: "pay_pix", orderId: order, actor: "other", amountInCents: 1, mode: "production" })).status).toBe(400);
    expect(state.record).not.toHaveBeenCalled();
  });
  it("keeps purchases closed without the explicit authorized TEST actor", async () => {
    vi.stubEnv("REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED", "false");
    expect((await send({ action: "pay_pix", orderId: order })).status).toBe(403);
    expect(state.record).not.toHaveBeenCalled();
  });
  it("rejects an actor different from the isolated TEST authorization", async () => {
    vi.stubEnv("REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED", "true");
    vi.stubEnv("REPRESENTATIVE_TEST_ACTOR_ID", "different-actor");
    expect((await send({ action: "pay_pix", orderId: order })).status).toBe(403);
    expect(state.record).not.toHaveBeenCalled();
  });
  it("binds reads to the verified actor and hides internal payment identity", async () => {
    state.record.mockResolvedValue({ state: "reserved", amountInCents: 8043, refundedInCents: 0,
      remainingInCents: 8043, providerPaymentId: "private-id", paymentFingerprint: "private-fingerprint" });
    const response = await send({ action: "read", orderId: order });
    expect(response.status).toBe(200);
    expect(state.record).toHaveBeenCalledWith(expect.anything(), "read_kit_test_transaction", { p_actor: "actor", p_order: order });
    const body: unknown = await response.json();
    expect(body).not.toHaveProperty("providerPaymentId");
    expect(body).not.toHaveProperty("paymentFingerprint");
  });
});
