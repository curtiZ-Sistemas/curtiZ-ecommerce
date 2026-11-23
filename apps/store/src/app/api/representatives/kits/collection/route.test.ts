import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  actor: "10000000-0000-4000-8000-000000000001", configured: true, collection: false,
  session: vi.fn(), access: vi.fn(), authBudget: vi.fn(), call: vi.fn()
}));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => true }));
vi.mock("@/lib/runtime-environment", () => ({ getStoreRuntimeEnvironment: () => ({
  REPRESENTATIVE_KIT_ORIGIN_POSTAL_CODE: "35520000",
  REPRESENTATIVE_KIT_MANUAL_FISCAL_ENABLED: "true",
  REPRESENTATIVE_KIT_COLLECTION_ENABLED: String(mock.collection)
}) }));
vi.mock("@/lib/representative-resale-scope", () => import("../../../../../lib/representative-resale-scope"));
vi.mock("@/lib/private-request", () => ({
  readPrivateJson: (request: Request) => request.json(), requirePrivateRateLimit: mock.authBudget,
  PrivateRequestError: class extends Error { status = 429; }
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({ auth: { getUser: mock.session }, rpc: mock.access }),
  createServiceSupabaseClient: () => ({})
}));
vi.mock("@/lib/representative-commercial-payments", () => ({ commercialKitCheckoutConfigured: () => mock.configured }));
vi.mock("@/lib/representative-test-transactions", () => ({
  KitTransactionError: class extends Error { constructor(readonly status = 409) { super(); } },
  kitCall: mock.call
}));

import { POST } from "./route";

const addressId = "10000000-0000-4000-8000-000000000003";
const variantId = "10000000-0000-4000-8000-000000000005";
const post = (body: object) => POST(new Request("https://curtiz.com.br/api/representatives/kits/collection", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
}));

beforeEach(() => {
  vi.resetAllMocks();
  mock.configured = true;
  mock.collection = false;
  mock.session.mockResolvedValue({ data: { user: { id: mock.actor } } });
});

describe("own delivery quote route", () => {
  it("quotes prepaid delivery by address", async () => {
    mock.call.mockResolvedValue({ id: "quote", shippingInCents: 0 });
    const response = await post({ variantId, addressId, quantity: 1, paymentTiming: "prepay" });
    expect(await response.json()).toEqual({ quote: { id: "quote", shippingInCents: 0 } });
    expect(mock.call).toHaveBeenCalledWith(expect.anything(), "quote_representative_kit_own_delivery",
      expect.objectContaining({ p_at_receipt: false, p_address: addressId }));
  });

  it("offers payment on receipt by address only while collection is enabled, without requiring a route", async () => {
    expect(await (await post({ variantId, addressId, quantity: 1, paymentTiming: "collection" })).json()).toEqual({ quote: null, reason: "collection" });
    expect(mock.call).not.toHaveBeenCalled();
    mock.collection = true;
    mock.call.mockResolvedValue({ id: "quote", collectionMethods: ["cash"] });
    const response = await post({ variantId, addressId, quantity: 1, paymentTiming: "collection" });
    expect(await response.json()).toEqual({ quote: { id: "quote", collectionMethods: ["cash"] } });
    expect(mock.call).toHaveBeenCalledWith(expect.anything(), "quote_representative_kit_own_delivery",
      expect.objectContaining({ p_at_receipt: true, p_origin: "35520000" }));
  });

  it("tells why the quote is empty: account not enabled, otherwise the address or the collection", async () => {
    mock.call.mockResolvedValue(null);
    mock.access.mockResolvedValueOnce({ data: false, error: null });
    expect(await (await post({ variantId, addressId, quantity: 1, paymentTiming: "prepay" })).json())
      .toEqual({ quote: null, reason: "not_enabled" });
    mock.access.mockResolvedValueOnce({ data: true, error: null });
    expect(await (await post({ variantId, addressId, quantity: 1, paymentTiming: "prepay" })).json())
      .toEqual({ quote: null, reason: "address" });
    mock.access.mockResolvedValueOnce({ data: null, error: { code: "42883" } });
    expect(await (await post({ variantId, addressId, quantity: 1, paymentTiming: "prepay" })).json())
      .toEqual({ quote: null, reason: "address" });
  });

  it("does not quote without a configured checkout or a session", async () => {
    mock.configured = false;
    expect(await (await post({ variantId, addressId, quantity: 1, paymentTiming: "prepay" })).json())
      .toEqual({ quote: null, reason: "unavailable" });
    mock.configured = true;
    mock.session.mockResolvedValueOnce({ data: { user: null } });
    expect((await post({ variantId, addressId, quantity: 1, paymentTiming: "prepay" })).status).toBe(401);
  });
});
