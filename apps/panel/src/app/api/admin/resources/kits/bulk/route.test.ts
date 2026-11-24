import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const productId = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({
  authorized: true,
  allowed: true,
  existing: [] as { grade_product_id: string; grade_color: string }[],
  inserted: [] as Record<string, unknown>[],
  insertError: null as { code?: string; message: string } | null
}));

vi.mock("@/lib/admin-api", () => {
  return {
    privateNoStore: { "cache-control": "private, no-store" },
    objectRows: (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value as Record<string, unknown>[] : [],
    readPanelJson: async (request: Request): Promise<unknown> => (await request.json()) as unknown,
    unauthorizedAdminResponse: () => new Response(null, { status: 401 }),
    authorizeAdminRequest: async () => state.authorized
      ? {
          userId: "user-1",
          supabase: {
            rpc: async () => ({ data: state.allowed, error: null }),
            from: () => ({
              select: () => {
                const query = {
                  is: () => query,
                  not: () => query,
                  limit: async () => ({ data: state.existing, error: null }),
                  in: async () => ({ data: state.existing, error: null })
                };
                return query;
              },
              insert: (values: Record<string, unknown>) => ({
                select: () => ({
                  single: async () => {
                    if (state.insertError) return { data: null, error: state.insertError };
                    state.inserted.push(values);
                    return { data: { id: String(state.inserted.length) }, error: null };
                  }
                })
              })
            })
          }
        }
      : null
  };
});

import { GET, POST } from "./route";

const sheet = {
  grade_standard_price_cents: 18_000,
  grade_lower_restock_price_cents: 18_000,
  grade_upper_restock_price_cents: 18_000,
  grade_standard_stock: 100,
  grade_lower_restock_stock: 100,
  grade_upper_restock_stock: 100
};
const item = (color: string) => ({ name: `Chinelo Liso – ${color}`, gradeSource: `${productId}|${color}`, ...sheet });
const post = (body: unknown) => POST(new NextRequest("http://localhost/api/admin/resources/kits/bulk", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
}));

beforeEach(() => {
  state.authorized = true;
  state.allowed = true;
  state.existing = [];
  state.inserted = [];
  state.insertError = null;
});

describe("cadastro rápido de kits em lote", () => {
  it("cria os kits ativos das cores novas e pula a cor que já tem kit", async () => {
    state.existing = [{ grade_product_id: productId, grade_color: "Preto" }];
    const response = await post({ items: [item("Preto"), item("Branco"), item("Rosa")] });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ created: 2, skipped: 1, failed: 0 });
    expect(state.inserted).toHaveLength(2);
    expect(state.inserted[0]).toMatchObject({
      name: "Chinelo Liso – Branco",
      slug: "chinelo-liso-branco",
      active: true,
      description: "",
      grade_product_id: productId,
      grade_color: "Branco",
      price_in_cents: 18_000,
      grade_upper_restock_stock: 100,
      created_by: "user-1"
    });
  });

  it("é idempotente: repetir o pedido não cria nada", async () => {
    state.existing = [{ grade_product_id: productId, grade_color: "Preto" }];
    const response = await post({ items: [item("Preto")] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ created: 0, skipped: 1 });
    expect(state.inserted).toHaveLength(0);
  });

  it("reporta erro por kit com preço inválido e cria os demais", async () => {
    const response = await post({ items: [{ ...item("Preto"), grade_standard_price_cents: 1 }, item("Branco")] });
    expect(await response.json()).toMatchObject({ created: 1, failed: 1 });
    expect(state.inserted).toHaveLength(1);
  });

  it("nega a operação sem a permissão de gerir regras", async () => {
    state.allowed = false;
    const response = await post({ items: [item("Preto")] });
    expect(response.status).toBe(403);
    expect(state.inserted).toHaveLength(0);
    expect((await GET(new NextRequest("http://localhost/api/admin/resources/kits/bulk"))).status).toBe(403);
  });

  it("recusa sessão não autorizada e corpo inválido", async () => {
    state.authorized = false;
    expect((await post({ items: [item("Preto")] })).status).toBeGreaterThanOrEqual(401);
    state.authorized = true;
    expect((await post({ items: [] })).status).toBe(400);
  });
});
