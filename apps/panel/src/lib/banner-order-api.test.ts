import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(() => ({ authorized: true, permission: true, origin: true, previous: 0, priorities: [0, 5, -3],
  saved: null as Record<string, unknown> | null, conflict: false, readError: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-api", () => ({
  authorizeAdminRequest: async () => state.authorized ? {
    userId: "10000000-0000-4000-8000-000000000001",
    supabase: {
      rpc: async () => ({ data: state.permission, error: null }),
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { id: "10000000-0000-4000-8000-000000000002", priority: state.previous }, error: null }) }),
          order: (_column: string, options: { ascending: boolean }) => ({ limit: () => ({ maybeSingle: async () => ({
            data: { priority: options.ascending ? Math.min(...state.priorities) : Math.max(...state.priorities) },
            error: state.readError ? {} : null
          }) }) })
        }),
        update: (values: Record<string, unknown>) => ({
          eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => {
            if (state.conflict) return { data: null, error: null };
            state.saved = values;
            return { data: { id: "10000000-0000-4000-8000-000000000002" }, error: null };
          } }) }) })
        })
      })
    }
  } : null,
  privateNoStore: { "cache-control": "private, no-store" },
  readPanelJson: (request: Request) => request.json(),
  safePanelOrigin: () => state.origin,
  unauthorizedAdminResponse: () => NextResponse.json({ message: "Não autorizado" }, { status: 401 }),
  objectRows: (value: unknown): unknown[] => Array.isArray(value) ? (value as unknown[]) : []
}));
vi.mock("@/lib/banner-management-server", () => ({ bannerFailure: () => "Erro", validateBannerReferences: vi.fn() }));
import { PATCH } from "../app/api/admin/resources/[resource]/route";

const id = "10000000-0000-4000-8000-000000000002";
const move = (body: unknown = { action: "move", id, position: "first" }) => PATCH(
  new NextRequest("http://localhost:3001/api/admin/resources/banners", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  }), { params: Promise.resolve({ resource: "banners" }) }
);

describe("reordenação de banners", () => {
  beforeEach(() => { state.authorized = true; state.permission = true; state.origin = true; state.previous = 0; state.priorities = [0, 5, -3];
    state.saved = null; state.conflict = false; state.readError = false; });
  it("exige sessão e permissão antes de alterar a ordem", async () => {
    state.authorized = false;
    expect((await move()).status).toBe(401);
    state.authorized = true; state.permission = false;
    expect((await move()).status).toBe(403);
    state.permission = true; state.origin = false;
    expect((await move()).status).toBe(403);
    expect(state.saved).toBeNull();
  });
  it.each([["first", 6], ["last", -4]] as const)("move para %s sem alterar os demais campos", async (position, priority) => {
    expect((await move({ action: "move", id, position })).status).toBe(200);
    expect(state.saved).toEqual({ priority, updated_by: "10000000-0000-4000-8000-000000000001" });
  });
  it("não altera o banner quando a ordem mudou durante a operação", async () => {
    state.conflict = true;
    expect((await move()).status).toBe(409);
    expect(state.saved).toBeNull();
  });
  it("recusa valores inválidos e limites de inteiro sem gravar", async () => {
    expect((await move({ action: "move", id, position: "middle" })).status).toBe(400);
    expect((await move({ action: "move", id, position: "first", values: { status: "archived" } })).status).toBe(400);
    state.priorities = [0, 2147483647];
    expect((await move()).status).toBe(409);
    expect(state.saved).toBeNull();
  });
  it("reporta falha de consulta sem gravar", async () => {
    state.readError = true;
    expect((await move()).status).toBe(503);
    expect(state.saved).toBeNull();
  });
});
