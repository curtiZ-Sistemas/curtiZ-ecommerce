import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn(), createServiceSupabaseClient: vi.fn() }));
vi.mock("@curtiz/integrations", () => ({ isMercadoPagoTestCredential: () => false }));
vi.mock("@/lib/customer-account-presentation", () => import("../../../../../lib/customer-account-presentation"));
vi.mock("@/lib/mercadopago-payment", () => import("../../../../../lib/mercadopago-payment"));
vi.mock("@/lib/unknown-data", () => import("../../../../../lib/unknown-data"));

const context = { params: Promise.resolve({ id: "order-id" }) };
const request = new Request("https://store.example/api/orders/order-id/payment");

function setup(status = "pending_payment", paymentStatus = "pending", expiresAt = "", detail = "") {
  const from = vi.fn((table: string) => {
    if (table === "order_items") return {
      select: () => ({ eq: async () => ({ data: [{ variant_id: "variant-id" }], error: null }) })
    };
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: table === "orders"
        ? { id: "order-id", customer_id: "customer-id", public_code: "ORDER", status, payment_status: paymentStatus }
        : { id: "payment-id", status: paymentStatus, status_detail: detail, expires_at: expiresAt, payment_method_summary: "pix" }, error: null }))
    };
    return query;
  });
  vi.mocked(createServerSupabaseClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "customer-id" } } }) } } as never);
  vi.mocked(createServiceSupabaseClient).mockReturnValue({ from } as never);
  return from;
}

describe("payment endpoint resumption guard", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(["cancellation_requested", "cancelled", "expired", "payment_approved", "processing", "preparing", "shipped", "delivered", "refunded"])("blocks %s without returning payment instructions", async (status) => {
    const from = setup(status);
    const response = await GET(request, context);
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("pixCopyPaste");
    expect(from).not.toHaveBeenCalledWith("order_items");
  });
  it.each([
    ["pending", "2020-01-01T00:00:00Z", ""],
    ["pending", "", "expired"],
    ["approved", "", ""],
    ["cancelled", "", ""],
    ["refunded", "", ""]
  ])("blocks a non-resumable payment (%s %s %s)", async (status, expiresAt, detail) => {
    setup("pending_payment", status, expiresAt, detail);
    expect((await GET(request, context)).status).toBe(409);
  });
  it("returns the pending payment and scopes lookup to the authenticated customer", async () => {
    const from = setup();
    const response = await GET(request, context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ status: "pending" }));
    expect(from).toHaveBeenCalledWith("orders");
  });
  it("requires authentication", async () => {
    setup();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(null);
    expect((await GET(request, context)).status).toBe(401);
    expect(createServiceSupabaseClient).not.toHaveBeenCalled();
  });
  it("returns only cart cleanup data for an approved order", async () => {
    setup("payment_approved", "approved");
    const response = await GET(request, context);
    expect(response.status).toBe(409);
    const result: unknown = await response.json();
    expect(result).toEqual(expect.objectContaining({ status: "approved", variantIds: ["variant-id"] }));
    expect(result).not.toHaveProperty("pixCopyPaste");
    expect(result).not.toHaveProperty("boletoUrl");
  });
});
