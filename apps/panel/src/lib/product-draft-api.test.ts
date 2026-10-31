vi.mock("server-only", () => ({}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type StoredDraft = {
  schema_version: number;
  payload: Record<string, unknown>;
  saved_at: string;
  updated_at: string;
};

const state = vi.hoisted(() => ({
  userId: "10000000-0000-4000-8000-000000000001",
  allowed: true,
  authCalls: 0,
  rows: new Map<string, StoredDraft>()
}));

const client = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === "has_permission") return { data: state.allowed, error: null };
    if (name === "save_product_editor_draft") {
      const savedAt = String(args.p_saved_at);
      const current = state.rows.get(state.userId);
      if (!current || Date.parse(current.saved_at) <= Date.parse(savedAt)) {
        state.rows.set(state.userId, {
          schema_version: Number(args.p_schema_version),
          payload: args.p_payload as Record<string, unknown>,
          saved_at: savedAt,
          updated_at: new Date().toISOString()
        });
      }
      return { data: state.rows.get(state.userId)?.saved_at, error: null };
    }
    return { data: null, error: { code: "PGRST202", message: "unknown rpc" } };
  },
  from: () => {
    let mode: "select" | "delete" = "select";
    let userId = state.userId;
    const chain = {
      select: () => chain,
      delete: () => { mode = "delete" as const; return chain; },
      eq: (_column: string, value: string) => { userId = value; return chain; },
      maybeSingle: async () => ({ data: state.rows.get(userId) ?? null, error: null }),
      then: (resolve: (value: { error: null }) => unknown) => {
        if (mode === "delete") state.rows.delete(userId);
        return Promise.resolve({ error: null }).then(resolve);
      }
    };
    return chain;
  }
};

vi.mock("@/lib/admin-api", () => ({
  authorizeAdminRequest: async () => {
    state.authCalls += 1;
    return state.allowed ? { supabase: client, userId: state.userId } : null;
  },
  privateNoStore: { "cache-control": "private, no-store" },
  readPanelJson: (request: Request) => request.json(),
  safePanelOrigin: (request: Request) => request.headers.get("origin") === "http://localhost:3001",
  unauthorizedAdminResponse: () => Response.json({ message: "Sem acesso." }, { status: 401 })
}));
vi.mock("@curtiz/security", () => ({ logServerEvent: vi.fn() }));
vi.mock("@/lib/product-draft", () => import("./product-draft"));

import { DELETE, GET, PUT } from "../app/api/catalog/product-draft/route";
import { buildNewProductDraft, newProductDraftSchema } from "./product-draft";

const makeDraft = (name: string, savedAt: string) => {
  const draft = buildNewProductDraft({
    savedAt,
    fields: {
      name,
      slug: "slide-teste",
      description: "Descrição",
      modelId: "",
      collectionId: "",
      statusReason: "",
      price: "59.90",
      compareAtPrice: "",
      cost: "",
      stockReason: "Estoque definido no cadastro do produto",
      weightGrams: "",
      heightCm: "",
      widthCm: "",
      lengthCm: "40",
      shortDescription: "",
      productKind: "variations",
      futureEditorControl: "não deve ser persistido"
    },
    categoryIds: ["20000000-0000-4000-8000-000000000001"],
    primaryCategoryId: "20000000-0000-4000-8000-000000000001",
    variants: [
      {
        sku: "SLIDE-39", color: "Azul", colorHex: "#0000ff", colorHexSecondary: "",
        size: "39", priceInCents: null, costInCents: null, stock: 2, active: true, gtin: "", mpn: ""
      },
      {
        sku: "SLIDE-40", color: "Azul", colorHex: "#0000ff", colorHexSecondary: "",
        size: "40", priceInCents: null, costInCents: null, stock: 2, active: true, gtin: "", mpn: ""
      }
    ],
    hasVariations: true,
    simpleStock: 0,
    productActive: false,
    variantColors: "Azul",
    variantSizes: "39, 40",
    variantSkuPrefix: "SLIDE",
    sizeGuide: [
      { clientRowId: "row-39", size: "39", measurementCm: 27 },
      { clientRowId: "row-40", size: "40", measurementCm: 27 }
    ],
    specifications: [{ label: "Material", value: "Borracha" }]
  });
  if (!draft) throw new Error("The real editor snapshot must satisfy the shared draft contract");
  return draft;
};

const request = (method = "GET", body?: unknown) => new NextRequest(
  "http://localhost:3001/api/catalog/product-draft",
  {
    method,
    headers: { origin: "http://localhost:3001", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }
);

beforeEach(() => {
  state.rows.clear();
  state.userId = "10000000-0000-4000-8000-000000000001";
  state.allowed = true;
  state.authCalls = 0;
});

describe("product draft API", () => {
  it("accepts the real editor snapshot with empty optional dimensions and two size-guide rows", async () => {
    const draft = makeDraft("Slide real", "2026-09-20T12:00:00.000Z");
    expect(newProductDraftSchema.safeParse(draft).success).toBe(true);
    expect(draft.fields).not.toHaveProperty("productKind");
    expect(draft.fields).not.toHaveProperty("futureEditorControl");
    const response = await PUT(request("PUT", draft));
    expect(response.status).toBe(200);
    expect(state.rows.get(state.userId)?.payload).toMatchObject({
      fields: { weightGrams: "", heightCm: "", widthCm: "", lengthCm: "40" },
      sizeGuide: [{ size: "39", measurementCm: 27 }, { size: "40", measurementCm: 27 }]
    });
  });

  it("rejects an invalid payload before authentication or rate-limit work", async () => {
    const response = await PUT(request("PUT", { schemaVersion: 1, userId: state.userId }));
    expect(response.status).toBe(400);
    expect(state.authCalls).toBe(0);
  });

  it("returns an empty private response when the account has no draft", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, draft: null });
  });

  it("creates once, overwrites twice and recovers the latest snapshot in another session", async () => {
    for (const [name, savedAt] of ([
      ["Primeiro", "2026-09-20T12:00:00.000Z"],
      ["Segundo", "2026-09-20T12:01:00.000Z"],
      ["Terceiro", "2026-09-20T12:02:00.000Z"]
    ] as const)) {
      expect((await PUT(request("PUT", makeDraft(name, savedAt)))).status).toBe(200);
      expect(state.rows.size).toBe(1);
    }
    const response = await GET(request());
    expect(await response.json()).toMatchObject({ draft: {
      fields: { name: "Terceiro" },
      categoryIds: ["20000000-0000-4000-8000-000000000001"],
      variants: [{ size: "39", stock: 2 }, { size: "40", stock: 2 }],
      sizeGuide: [{ size: "39", measurementCm: 27 }, { size: "40", measurementCm: 27 }],
      specifications: [{ label: "Material", value: "Borracha" }]
    } });
  });

  it("does not let an older request overwrite the newest snapshot", async () => {
    await PUT(request("PUT", makeDraft("Novo", "2026-09-20T12:02:00.000Z")));
    await PUT(request("PUT", makeDraft("Atrasado", "2026-09-20T12:01:00.000Z")));
    expect(state.rows.get(state.userId)?.payload).toMatchObject({ fields: { name: "Novo" } });
  });

  it("derives ownership from the session and isolates read, update and delete by user", async () => {
    const userA = state.userId;
    await PUT(request("PUT", makeDraft("Usuário A", "2026-09-20T12:00:00.000Z")));
    state.userId = "10000000-0000-4000-8000-000000000002";
    expect(await (await GET(request())).json()).toEqual({ ok: true, draft: null });
    expect((await PUT(request("PUT", { ...makeDraft("Ataque", "2026-09-20T12:01:00.000Z"), userId: userA }))).status).toBe(400);
    await DELETE(request("DELETE"));
    expect(state.rows.get(userA)?.payload).toMatchObject({ fields: { name: "Usuário A" } });
  });

  it("deletes the owner draft permanently and rejects users without product permissions", async () => {
    await PUT(request("PUT", makeDraft("Descartar", "2026-09-20T12:00:00.000Z")));
    expect((await DELETE(request("DELETE"))).status).toBe(200);
    expect(await (await GET(request())).json()).toEqual({ ok: true, draft: null });
    state.allowed = false;
    expect((await PUT(request("PUT", makeDraft("Sem acesso", "2026-09-20T12:03:00.000Z")))).status).toBe(401);
  });

  it("rejects cross-origin writes before accepting the body", async () => {
    const input = request("PUT", makeDraft("Ataque", "2026-09-20T12:00:00.000Z"));
    input.headers.set("origin", "https://attacker.example");
    expect((await PUT(input)).status).toBe(403);
    expect(input.bodyUsed).toBe(false);
  });
});
