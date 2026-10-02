import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ auth: vi.fn(), userRpc: vi.fn(), request: vi.fn(), document: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ auth: { getUser: state.auth }, rpc: state.userRpc }),
  createServiceSupabaseClient: () => ({ rpc: vi.fn() }) }));
vi.mock("@/lib/unknown-data", () => ({ isUnknownRecord: (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v),
  readString: (v: Record<string, unknown>, key: string) => typeof v[key] === "string" ? v[key] : "" }));
vi.mock("@curtiz/integrations", () => ({ createBlingClient: () => ({ request: state.request, invoiceDocument: state.document }) }));
import { GET } from "./route";
const context = { params: Promise.resolve({ id: "b1000000-0000-4000-8000-000000000001" }) };
const key = "1".repeat(44);
beforeEach(() => {
  state.auth.mockReset().mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
  state.userRpc.mockReset().mockResolvedValue({ data: { accessKey: key, invoiceId: 123 }, error: null });
  state.request.mockReset().mockResolvedValue({ data: { situacao: 5, chaveAcesso: key } });
  state.document.mockReset().mockResolvedValue(new TextEncoder().encode("%PDF-test").buffer);
});
describe("customer fiscal documents", () => {
  it("requires a verified session", async () => {
    state.auth.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET(new Request("https://store.example"), context)).status).toBe(401);
    expect(state.document).not.toHaveBeenCalled();
  });
  it("blocks another customer's order before contacting Bling", async () => {
    state.userRpc.mockResolvedValue({ data: null, error: null });
    expect((await GET(new Request("https://store.example"), context)).status).toBe(404);
    expect(state.request).not.toHaveBeenCalled();
  });
  it.each([1, 2, 4, 9])("does not download a document whose current fiscal situation is %s", async (situacao) => {
    state.request.mockResolvedValue({ data: { situacao, chaveAcesso: key } });
    expect((await GET(new Request("https://store.example"), context)).status).toBe(404);
    expect(state.document).not.toHaveBeenCalled();
  });
  it("serves an authorized PDF without exposing tokens or an external URL", async () => {
    const result = await GET(new Request("https://store.example"), context);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("content-type")).toBe("application/pdf");
    expect(await result.text()).toBe("%PDF-test");
  });
});
