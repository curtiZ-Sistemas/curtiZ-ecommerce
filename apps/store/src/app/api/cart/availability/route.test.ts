import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPublicSupabaseClient } from "@/lib/supabase/server";
import { publicBudgetResponse } from "@/lib/public-request";
import { POST } from "./route";

vi.mock("@/lib/catalog", () => ({ demoProducts: [] }));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createPublicSupabaseClient: vi.fn() }));
vi.mock("@/lib/public-request", () => ({ publicBudgetResponse: vi.fn(async () => null as Response | null) }));
vi.mock("@/lib/unknown-data", () => ({
  isUnknownRecord: (value: unknown) => Boolean(value && typeof value === "object" && !Array.isArray(value)),
  readRows: (value: unknown): Record<string, unknown>[] => Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [],
  readString: (record: Record<string, unknown>, key: string) => typeof record[key] === "string" ? record[key] : ""
}));

const variantId = "00000000-0000-4000-8000-000000000001";
const request = () => new Request("https://store.example/api/cart/availability", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://store.example" },
  body: JSON.stringify({ variantIds: [variantId] })
});

describe("cart availability API", () => {
  beforeEach(() => {
    vi.mocked(createPublicSupabaseClient).mockReset();
    vi.mocked(publicBudgetResponse).mockReset().mockResolvedValue(null);
    vi.stubEnv("DEMO_MODE", "false");
  });

  it.each([429, 503])("blocks inventory queries before reading a body when the shared budget returns %s", async (status) => {
    vi.mocked(publicBudgetResponse).mockResolvedValue(Response.json({ message: "Unavailable" }, { status }));
    const input = request();
    expect((await POST(input)).status).toBe(status);
    expect(input.bodyUsed).toBe(false);
    expect(createPublicSupabaseClient).not.toHaveBeenCalled();
    expect(publicBudgetResponse).toHaveBeenCalledWith(input, "availability");
  });

  it("returns diagnostic JSON when public Supabase configuration is absent", async () => {
    vi.mocked(createPublicSupabaseClient).mockReturnValue(null);
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(result.headers.get("content-type")).toContain("application/json");
    const payload: unknown = await result.json();
    expect(payload).toMatchObject({ error: "availability_configuration_missing" });
    expect(payload && typeof payload === "object" && "requestId" in payload
      ? typeof payload.requestId
      : "missing").toBe("string");
  });

  it("identifies an unapplied availability migration", async () => {
    vi.mocked(createPublicSupabaseClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: {
        code: "PGRST202", message: "function not found", details: "", hint: "reload schema"
      } })
    } as never);
    const result = await POST(request());
    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toMatchObject({ error: "availability_migration_required" });
  });

  it("keeps unexpected Worker failures as JSON", async () => {
    vi.mocked(createPublicSupabaseClient).mockImplementation(() => {
      throw new Error("runtime unavailable");
    });
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(result.headers.get("content-type")).toContain("application/json");
    await expect(result.json()).resolves.toMatchObject({ error: "availability_service_unavailable" });
  });

  it("returns stock availability from the scoped RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ variantId, available: false, unavailableAt: null }], error: null
    });
    vi.mocked(createPublicSupabaseClient).mockReturnValue({ rpc } as never);
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("cart_variant_stock_availability", {
      p_variant_ids: [variantId]
    });
    await expect(result.json()).resolves.toMatchObject({
      items: [{ variantId, available: false }]
    });
  });
});
