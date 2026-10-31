import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted((): { user: { id: string } | null; provider: ReturnType<typeof vi.fn> } => ({ user: { id: "actor" }, provider: vi.fn() }));
vi.mock("@/lib/http-origin", () => import("../../../../../lib/http-origin"));
vi.mock("@/lib/private-request", () => ({ readPrivateJson: (r: Request) => r.json(), requirePrivateRateLimit: vi.fn(),
  PrivateRequestError: class extends Error { status = 429; } }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }), createServiceSupabaseClient: vi.fn() }));
vi.mock("@/lib/melhor-envio-server", () => ({ configuredMelhorEnvioProvider: state.provider, resolveShippingProducts: vi.fn() }));
vi.mock("@/lib/runtime-environment", () => ({ getStoreRuntimeEnvironment: vi.fn() }));
vi.mock("@/lib/unknown-data", () => import("../../../../../lib/unknown-data"));
vi.mock("@/lib/representative-test-transactions", () => ({ kitTestProvider: vi.fn(),
  KitTransactionError: class extends Error { constructor(readonly status = 409) { super(); } } }));
import { POST } from "./route";
const input = { variantId: "10000000-0000-4000-8000-000000000001", quantity: 1, postalCode: "35500000" };
const send = (body: unknown = input, origin = "https://curtiz.com.br") => POST(new NextRequest("https://curtiz.com.br/api/representatives/kits/quote", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body)
}));
beforeEach(() => { vi.clearAllMocks(); state.user = { id: "actor" }; vi.stubEnv("ALLOWED_ORIGINS", "https://curtiz.com.br"); });
afterEach(() => vi.unstubAllEnvs());
describe("kit quote scope", () => {
  it("rejects foreign origins", async () => { expect((await send(input, "https://attacker.invalid")).status).toBe(403); });
  it("requires login", async () => { state.user = null; expect((await send()).status).toBe(401); });
  it("rejects client prices and quantities above the catalog boundary", async () => {
    expect((await send({ ...input, amountInCents: 1 })).status).toBe(400);
    expect((await send({ ...input, quantity: 100 })).status).toBe(400);
    expect(state.provider).not.toHaveBeenCalled();
  });
  it("does not request provider quotes until the actor is explicitly authorized", async () => {
    vi.stubEnv("REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED", "false");
    expect((await send()).status).toBe(403);
    expect(state.provider).not.toHaveBeenCalled();
  });
});
