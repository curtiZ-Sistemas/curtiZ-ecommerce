import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type UsersResult = { users: Array<{ lastAccessChange: { reason: string } | null; historyUnavailable: boolean }> };
const mocks = vi.hoisted(() => {
  const history: { data: Record<string, unknown>[]; error: unknown } = { data: [], error: null };
  return { history, rpc: vi.fn() };
});
vi.mock("@/lib/admin-api", () => ({
  authorizeAdminRequest: async () => ({ userId: "actor", supabase: {
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ order: () => ({ range: async () => ({
      data: [{ id: "user-1", user_roles: [] }, { id: "user-2", user_roles: [] }], count: 2, error: null
    }) }) }) })
  } }),
  objectRows: (value: unknown): unknown[] => Array.isArray(value) ? value as unknown[] : [],
  privateNoStore: { "cache-control": "private, no-store" },
  safePanelOrigin: () => true,
  unauthorizedAdminResponse: vi.fn()
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: vi.fn() }));
import { GET } from "../app/api/admin/users/route";

beforeEach(() => {
  mocks.history = { data: [], error: null };
  mocks.rpc.mockReset().mockImplementation(async (name: string) => name === "latest_user_access_history" ? mocks.history : { data: true, error: null });
});

describe("histórico da listagem de usuários", () => {
  it("consulta apenas os usuários da página e associa cada evento ao usuário correto", async () => {
    mocks.history.data = [{ entity_id: "user-2", reason: "Última alteração", created_at: "2026-01-01T00:00:00Z" }];
    const response = await GET(new NextRequest("http://localhost/api/admin/users"));
    const result = await response.json() as UsersResult;
    expect(mocks.rpc).toHaveBeenCalledWith("latest_user_access_history", { p_user_ids: ["user-1", "user-2"] });
    expect(result.users[0]).toMatchObject({ lastAccessChange: null, historyUnavailable: false });
    expect(result.users[1]?.lastAccessChange?.reason).toBe("Última alteração");
  });
  it("mantém usuários disponíveis e sinaliza falha do histórico", async () => {
    mocks.history.error = { message: "database unavailable" };
    const response = await GET(new NextRequest("http://localhost/api/admin/users"));
    const result = await response.json() as UsersResult;
    expect(response.status).toBe(200);
    expect(result.users).toHaveLength(2);
    expect(result.users.every((user: { historyUnavailable: boolean }) => user.historyUnavailable)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("database unavailable");
  });
});
