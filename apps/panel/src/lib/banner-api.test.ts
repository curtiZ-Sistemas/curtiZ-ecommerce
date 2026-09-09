import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(
  (): {
    authorized: boolean;
    permission: boolean;
    saved: Record<string, unknown>;
    failure: { code: string; message: string } | null;
  } => ({ authorized: true, permission: true, saved: {}, failure: null })
);
vi.mock("@/lib/admin-api", () => ({
  authorizeAdminRequest: async () =>
    state.authorized
      ? {
          userId: "10000000-0000-4000-8000-000000000001",
          supabase: {
            rpc: async () => ({ data: state.permission, error: null }),
            storage: {
              from: () => ({
                list: async (_directory: string, options: { search: string }) => ({
                  data: [{ name: options.search }],
                  error: null
                })
              })
            },
            from: () => ({
              insert: (values: Record<string, unknown>) => {
                state.saved = values;
                return {
                  select: () => ({
                    single: async () => ({
                      data: state.failure
                        ? null
                        : { ...values, id: "10000000-0000-4000-8000-000000000002" },
                      error: state.failure
                    })
                  })
                };
              }
            })
          }
        }
      : null,
  privateNoStore: { "cache-control": "private, no-store" },
  safePanelOrigin: () => true,
  unauthorizedAdminResponse: () =>
    NextResponse.json({ message: "Não autorizado" }, { status: 401 }),
  objectRows: (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : [])
}));
vi.mock("@/lib/admin-resources", async () => import("./admin-resources"));
vi.mock("@/lib/postgres-uuid", async () => import("./postgres-uuid"));
vi.mock("@/lib/banner-management", async () => import("./banner-management"));
import { POST } from "../app/api/admin/resources/[resource]/route";

const image =
  "banners/10000000-0000-4000-8000-000000000001/desktop-10000000-0000-4000-8000-000000000002.webp";
const values = {
  image_path_desktop: image,
  image_path_mobile: image,
  destination_type: "internal_page",
  destination_id: "produtos",
  destination_url: "/produtos",
  destination_type_mobile: "internal_page",
  destination_id_mobile: "ofertas",
  destination_url_mobile: "/ofertas"
};
const save = (input = values) =>
  POST(
    new NextRequest("http://localhost:3001/api/admin/resources/banners", {
      method: "POST",
      body: JSON.stringify({ values: input }),
      headers: { "content-type": "application/json" }
    }),
    { params: Promise.resolve({ resource: "banners" }) }
  );

describe("real banner POST handler with isolated Supabase adapter", () => {
  beforeEach(() => {
    state.authorized = true;
    state.permission = true;
    state.saved = {};
    state.failure = null;
  });
  it("returns 401 without an authorized internal session", async () => {
    state.authorized = false;
    expect((await save()).status).toBe(401);
    expect(state.saved).toEqual({});
  });
  it("returns 403 with a denied permission and never inserts", async () => {
    state.permission = false;
    expect((await save()).status).toBe(403);
    expect(state.saved).toEqual({});
  });
  it("persists independent routes with null UUIDs and non-null defaults", async () => {
    const response = await save();
    expect(response.status).toBe(201);
    expect(state.saved).toMatchObject({
      destination_id: null,
      destination_id_mobile: null,
      destination_url: "/produtos",
      destination_url_mobile: "/ofertas",
      status: "published",
      sort_order: 0,
      priority: 0
    });
    expect(await response.json()).toHaveProperty("item.id");
  });
  it("rejects missing images before a database mutation", async () => {
    expect((await save({ ...values, image_path_mobile: "" })).status).toBe(400);
    expect(state.saved).toEqual({});
  });
  it("reports a missing migration rather than claiming success", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.failure = { code: "PGRST204", message: "Could not find column" };
    const response = await save();
    expect(response.status).toBe(409);
    const body: unknown = await response.json();
    expect(body).toHaveProperty(
      "message",
      "O cadastro de banners precisa de uma atualização do banco. Contate o responsável técnico."
    );
    log.mockRestore();
  });
});
