import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as Security from "@curtiz/security";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { cancelDemoRepresentativeSale, recordDemoRepresentativeSale } from "../../../lib/demo-representative-store";
import { GET, POST } from "./route";

const demo = vi.hoisted(() => ({ session: null as null | { email: string; role: string; roles: string[] } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock("@/lib/demo-representative-store", () => import("../../../lib/demo-representative-store"));
vi.mock("@/lib/http-origin", () => import("../../../lib/http-origin"));
vi.mock("@/lib/pii", () => import("../../../lib/pii"));
vi.mock("@/lib/personal-data", () => import("../../../lib/personal-data"));
vi.mock("@/lib/unknown-data", () => import("../../../lib/unknown-data"));
vi.mock("@curtiz/security", async (importOriginal) => ({
  ...(await importOriginal<typeof Security>()),
  verifyDemoSession: () => demo.session
}));

function client(failing: string[], sale: { public_code: string } | null = null, filters: string[] = [], missingCounts: string[] = []) {
  const from = (table: string) => {
    const data = table === "representatives"
      ? { id: "rep-a", user_id: "user-a", public_code: "REP-A", status: "active" }
      : table === "representative_applications" || table === "profiles" ? null : [];
    const result = { data, error: failing.includes(table) ? { message: "unavailable" } : null, count: missingCounts.includes(table) ? null : 0 };
    const query = {
      select: () => query, eq: (key: string, value: string) => { filters.push(`${table}:${key}:${value}`); return query; }, gt: () => query, or: () => query,
      order: (column: string) => { filters.push(`${table}:order:${column}`); return query; }, range: (from: number, to: number) => { filters.push(`${table}:range:${from}:${to}`); return query; }, limit: () => query,
      maybeSingle: () => Promise.resolve(table === "representative_sales" ? { ...result, data: sale } : result),
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
    };
    return query;
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-a" } } }) },
    from,
    rpc: async (name: string) => name === "get_representative_portal_totals"
      ? { data: { confirmed_sales_in_cents: 1234, available_commission_in_cents: 50, kit_count: 1 }, error: null }
      : { data: [], error: null },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) }
  };
}

describe("representative snapshot", () => {
  beforeEach(() => { vi.clearAllMocks(); demo.session = null; });

  it("reports a failed inventory query without masking sales and totals", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client(["representative_inventory"]) as never);
    const response = await GET(new NextRequest("https://example.invalid/api/representatives"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      errors: { inventory: true, sales: false, totals: false },
      totals: { confirmedSalesInCents: 1234, availableCommissionInCents: 50, kitCount: 1 }
    });
  });

  it.each([
    { confirmed_sales_in_cents: 100, available_commission_in_cents: 1 },
    { confirmed_sales_in_cents: "9007199254740992", available_commission_in_cents: 1, kit_count: 0 },
    { confirmed_sales_in_cents: 100, available_commission_in_cents: -1, kit_count: 0 }
  ])("does not replace invalid financial totals with zero", async (totals) => {
    const database = client([]);
    database.rpc = async (name: string) => name === "get_representative_portal_totals"
      ? { data: totals, error: null } as never
      : { data: [], error: null };
    vi.mocked(createServerSupabaseClient).mockResolvedValue(database as never);
    const response = await GET(new NextRequest("https://example.invalid/api/representatives"));
    expect(await response.json()).toMatchObject({ errors: { totals: true, sales: false }, totals: null });
  });

  it("accepts safely representable totals returned as decimal strings", async () => {
    const database = client([]);
    database.rpc = async (name: string) => name === "get_representative_portal_totals"
      ? { data: { confirmed_sales_in_cents: "1234", available_commission_in_cents: "50", kit_count: "1" }, error: null } as never
      : { data: [], error: null };
    vi.mocked(createServerSupabaseClient).mockResolvedValue(database as never);
    const response = await GET(new NextRequest("https://example.invalid/api/representatives"));
    expect(await response.json()).toMatchObject({
      errors: { totals: false },
      totals: { confirmedSalesInCents: 1234, availableCommissionInCents: 50, kitCount: 1 }
    });
  });

  it("does not present partial page lengths as complete counts", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client([], null, [], ["representative_sales", "representative_network_closure"]) as never);
    const response = await GET(new NextRequest("https://example.invalid/api/representatives"));
    const body = (await response.json()) as { errors: Record<string, boolean>; pagination: unknown };
    expect(body.errors).toMatchObject({ sales: false, salesCount: true, team: false, teamCount: true, totals: false });
    expect(body.pagination).toEqual({});
  });

  it("does not treat an application query failure as a missing application", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client(["representative_applications"]) as never);
    const response = await GET(new NextRequest("https://example.invalid/api/representatives"));
    expect(response.status).toBe(503);
  });

  it("filters sale status in the server query before pagination", async () => {
    const filters: string[] = [];
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client([], null, filters) as never);
    const response = await GET(new NextRequest("https://example.invalid/api/representatives?page=2&saleStatus=cancelled"));
    expect(response.status).toBe(200);
    expect(filters).toContain("representative_sales:representative_id:rep-a");
    expect(filters).toContain("representative_sales:status:cancelled");
    expect(filters).toContain("representative_sales:order:sold_at");
    expect(filters).toContain("representative_sales:order:id");
    expect(filters.indexOf("representative_sales:status:cancelled")).toBeLessThan(filters.indexOf("representative_sales:range:20:39"));
    expect(await response.json()).toMatchObject({ pagination: { sales: { page: 2, total: 0 } } });
  });

  it("rejects unsupported sale status filters", async () => {
    const response = await GET(new NextRequest("https://example.invalid/api/representatives?saleStatus=unexpected"));
    expect(response.status).toBe(400);
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("filters and paginates demo sales without changing overall totals", async () => {
    const email = "representante.demo@curtiz.local";
    demo.session = { email, role: "representative", roles: ["representative"] };
    const items = [{ variantId: "10000000-0000-4000-8000-000000000001", quantity: 1 }];
    for (let index = 0; index < 21; index += 1) {
      const sale = recordDemoRepresentativeSale(email, items, crypto.randomUUID());
      cancelDemoRepresentativeSale(email, sale.id);
    }
    const confirmed = recordDemoRepresentativeSale(email, items, crypto.randomUUID());
    const response = await GET(new NextRequest("https://example.invalid/api/representatives?page=2&saleStatus=cancelled"));
    const body = (await response.json()) as { sales: Array<{ status: string }>; pagination: { sales: { total: number } }; totals: { confirmedSalesInCents: number } };
    expect(body.sales).toHaveLength(1);
    expect(body.sales[0]?.status).toBe("cancelled");
    expect(body.pagination.sales.total).toBe(21);
    expect(body.totals.confirmedSalesInCents).toBe(confirmed.totalInCents);
  });

  it("looks up an uncertain sale only within the authenticated representative", async () => {
    const filters: string[] = [];
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client([], { public_code: "VD-TEST" }, filters) as never);
    const response = await GET(new NextRequest("https://example.invalid/api/representatives?saleAttempt=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    expect(await response.json()).toEqual({ found: true, publicCode: "VD-TEST" });
    expect(filters).toContain("representative_sales:representative_id:rep-a");
    expect(filters).toContain("representative_sales:idempotency_key:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("does not confirm a pending sale when the lookup returns no row", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client([]) as never);
    const response = await GET(new NextRequest("https://example.invalid/api/representatives?saleAttempt=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ found: false, publicCode: null });
  });

  it("does not report an unavailable lookup as a missing sale", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client(["representative_sales"]) as never);
    const response = await GET(new NextRequest("https://example.invalid/api/representatives?saleAttempt=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("found");
  });

  it("requires a verified user before looking up a sale", async () => {
    const database = client([]);
    database.auth.getUser = async () => ({ data: { user: null } }) as never;
    vi.mocked(createServerSupabaseClient).mockResolvedValue(database as never);
    const response = await GET(new NextRequest("https://example.invalid/api/representatives?saleAttempt=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    expect(response.status).toBe(401);
  });

  it("does not claim a sale failed when the database result is uncertain", async () => {
    const database = client([]);
    database.rpc = async () => ({ data: null, error: { message: "connection lost" } }) as never;
    vi.mocked(createServerSupabaseClient).mockResolvedValue(database as never);
    const request = new NextRequest("http://localhost:3000/api/representatives", {
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ action: "record_sale", idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        items: [{ variantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", quantity: 1 }] })
    });
    const response = await POST(request);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("confirmar");
  });

  it("reports a definite database constraint rejection separately", async () => {
    const database = client([]);
    database.rpc = async () => ({ data: null, error: { code: "23514", message: "insufficient inventory" } }) as never;
    vi.mocked(createServerSupabaseClient).mockResolvedValue(database as never);
    const response = await POST(new NextRequest("http://localhost:3000/api/representatives", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ action: "record_sale", idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        items: [{ variantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", quantity: 1 }] })
    }));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("recusada");
  });

  it("confirms the sale but warns when complementary data cannot be saved", async () => {
    const database = client([]);
    const rpc = vi.fn(async (name: string) => name === "record_representative_sale"
      ? { data: { id: "sale-a", public_code: "VD-TEST", status: "confirmed", total_in_cents: 5000 }, error: null }
      : { data: null, error: { code: "23514" } });
    database.rpc = rpc as never;
    vi.mocked(createServerSupabaseClient).mockResolvedValue(database as never);
    const response = await POST(new NextRequest("http://localhost:3000/api/representatives", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ action: "record_sale", idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        items: [{ variantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", quantity: 1 }], paymentMethod: "pix" })
    }));
    expect(response.status).toBe(207);
    const body = (await response.json()) as { publicCode: string; warning: string };
    expect(body.publicCode).toBe("VD-TEST");
    expect(body.warning).toContain("venda foi registrada");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("does not create a legacy kit order before resale is homologated", async () => {
    const database = client([]);
    const rpc = vi.fn(database.rpc);
    database.rpc = rpc;
    vi.mocked(createServerSupabaseClient).mockResolvedValue(database as never);
    const response = await POST(new NextRequest("http://localhost:3000/api/representatives", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ action: "buy_kit", idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        kitId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "RESALE_NOT_HOMOLOGATED" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
