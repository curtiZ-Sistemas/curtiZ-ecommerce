import { describe, expect, it, vi } from "vitest";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock("@curtiz/security", () => ({ DEMO_SESSION_COOKIE: "demo", verifyDemoSession: () => null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => true }));
vi.mock("@/lib/personal-data", () => import("../../../lib/personal-data"));
vi.mock("@/lib/unknown-data", () => import("../../../lib/unknown-data"));

const savedId = "11111111-1111-4111-8111-111111111111";
const body = { action: "address_save", id: savedId, label: "Casa 2", recipientName: "Cliente Teste",
  postalCode: "01310-100", street: "Avenida Paulista", number: "10", complement: "", district: "Bela Vista",
  city: "Sao Paulo", state: "sp", isDefault: false };

describe("saved address response", () => {
  it.each([false, true])("preserves the saved ID even if reading the canonical address fails (%s)", async (readFails) => {
    const address = { id: savedId, label: "Casa 2", state: "SP", postal_code: "01310100", is_default: false };
    const rpc = vi.fn(async () => ({ data: savedId, error: null }));
    const query = { select: () => query, eq: vi.fn(() => query), single: async () => readFails
      ? { data: null, error: { message: "unavailable" } } : { data: address, error: null } };
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "customer-id" } } }) }, rpc, from: () => query
    } as never);
    const response = await POST(new Request("https://store.example/api/customer", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: savedId, address: readFails ? null : address });
    expect(rpc).toHaveBeenCalledWith("save_customer_address", expect.objectContaining({ p_id: savedId, p_is_default: false }));
    expect(query.eq).toHaveBeenCalledWith("user_id", "customer-id");
  });
});
