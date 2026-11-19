import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  actor: "10000000-0000-4000-8000-000000000001", configured: false, originAllowed: true,
  session: vi.fn(), authBudget: vi.fn(), record: vi.fn(), call: vi.fn(),
  begin: vi.fn(), cancel: vi.fn(), refresh: vi.fn(), makeProvider: vi.fn(),
  originPostal: "35520000"
}));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => mock.originAllowed }));
vi.mock("@/lib/runtime-environment", () => ({ getStoreRuntimeEnvironment: () => ({
  REPRESENTATIVE_KIT_ORIGIN_POSTAL_CODE: mock.originPostal
}) }));
vi.mock("@/lib/representative-resale-scope", () => import("../../../../../lib/representative-resale-scope"));
vi.mock("@/lib/private-request", () => ({
  readPrivateJson: (request: Request) => request.json(), requirePrivateRateLimit: mock.authBudget,
  PrivateRequestError: class extends Error { status = 429; }
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({ auth: { getUser: mock.session } }),
  createServiceSupabaseClient: () => ({})
}));
vi.mock("@/lib/representative-commercial-payments", () => ({
  commercialKitCheckoutConfigured: () => mock.configured, kitPaymentView: (order: unknown) => order,
  commercialKitCollector: () => "123", commercialKitPaymentProvider: mock.makeProvider,
  beginCommercialKitPix: mock.begin, cancelCommercialKitPayment: mock.cancel, refreshCommercialKitPayment: mock.refresh
}));
vi.mock("@/lib/representative-test-transactions", () => ({
  KitTransactionError: class extends Error { constructor(readonly status = 409) { super(); } },
  kitRecord: mock.record, kitCall: mock.call
}));

import { POST } from "./route";

const orderId = "10000000-0000-4000-8000-000000000002";
const addressId = "10000000-0000-4000-8000-000000000003";
const quoteId = "10000000-0000-4000-8000-000000000004";
const variantId = "10000000-0000-4000-8000-000000000005";
const idempotencyKey = "10000000-0000-4000-8000-000000000006";
const reserve = { action: "reserve", quoteId, addressId, variantId, idempotencyKey, quantity: 2 } as const;
const post = (body: object) => POST(new Request("https://curtiz.com.br/api/representatives/kits/orders", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
}));

beforeEach(() => {
  vi.resetAllMocks();
  mock.configured = false;
  mock.originAllowed = true;
  mock.originPostal = "35520000";
  mock.session.mockResolvedValue({ data: { user: { id: mock.actor, email: "verified@example.invalid",
    email_confirmed_at: "2026-11-18T00:00:00Z" } } });
});

describe("commercial kit order route", () => {
  it("blocks origin before reading the account", async () => {
    mock.originAllowed = false;
    expect((await post(reserve)).status).toBe(403);
    expect(mock.session).not.toHaveBeenCalled();
  });

  it("requires a valid session and rejects customer-supplied prices and identities", async () => {
    expect((await post({ ...reserve, amountInCents: 1, actorId: mock.actor })).status).toBe(400);
    mock.session.mockResolvedValueOnce({ data: { user: null } });
    expect((await post(reserve)).status).toBe(401);
    expect(mock.record).not.toHaveBeenCalled();
  });

  it("blocks both new writes when commercial release is closed without calling a provider", async () => {
    for (const body of [reserve,{ action: "pix", orderId }]) {
      const response = await post(body);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "RESALE_NOT_HOMOLOGATED" });
    }
    expect(mock.makeProvider).not.toHaveBeenCalled();
    expect(mock.record).not.toHaveBeenCalled();
  });

  it("reserves through the service RPC with only server-derived actor and origin", async () => {
    mock.configured = true;
    mock.record.mockResolvedValue({ orderId, state: "reserved" });
    const response = await post(reserve);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mock.record).toHaveBeenCalledWith(expect.anything(),"reserve_representative_kit_own_delivery",{
      p_actor: mock.actor, p_origin: "35520000", p_selection: variantId, p_template: null, p_quantity: 2,
      p_quote: quoteId, p_address: addressId, p_key: idempotencyKey
    });
    mock.originPostal = "01310100";
    expect((await post(reserve)).status).toBe(503);
    expect(mock.record).toHaveBeenCalledOnce();
  });

  it("keeps status and cancellation available when checkout is disabled", async () => {
    const provider = {};
    mock.makeProvider.mockReturnValue(provider);
    mock.cancel.mockResolvedValue({ state: "cancelled" });
    mock.refresh.mockResolvedValue({ state: "paid" });
    mock.call.mockResolvedValue(null);
    expect((await post({ action: "cancel",orderId })).status).toBe(200);
    expect((await post({ action: "status",orderId })).status).toBe(200);
    expect(mock.cancel).toHaveBeenCalledWith(expect.anything(),provider,"123",mock.actor,orderId);
    expect(mock.refresh).toHaveBeenCalledWith(expect.anything(),provider,"123",mock.actor,orderId);
  });
});
