import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  session: true,
  allowed: true,
  error: null as null | { message: string },
  roles: [] as readonly string[]
}));
vi.mock("./admin-api", () => ({
  authorizeAdminRequest: async (_request: Request, roles: readonly string[]) => {
    state.roles = roles;
    return state.session
      ? {
          userId: "test-user",
          supabase: { rpc: async () => ({ data: state.allowed, error: state.error }) }
        }
      : null;
  }
}));
import { authorizeLegalRequest } from "./legal-api";
describe("autorização jurídica por permissão", () => {
  beforeEach(() => {
    state.session = true;
    state.allowed = true;
    state.error = null;
  });
  it("exige sessão administrativa ou gerencial validada", async () => {
    state.session = false;
    expect(
      await authorizeLegalRequest(
        new NextRequest("http://localhost:3001/api/legal/policies"),
        "legal_content.publish"
      )
    ).toBeNull();
    expect(state.roles).toEqual(["admin", "manager"]);
  });
  it("nega permissão ausente ou erro de verificação", async () => {
    state.allowed = false;
    expect(
      await authorizeLegalRequest(
        new NextRequest("http://localhost:3001/api/legal/policies"),
        "legal_content.publish"
      )
    ).toBeNull();
    state.allowed = true;
    state.error = { message: "database unavailable" };
    expect(
      await authorizeLegalRequest(
        new NextRequest("http://localhost:3001/api/legal/policies"),
        "legal_content.publish"
      )
    ).toBeNull();
  });
});
