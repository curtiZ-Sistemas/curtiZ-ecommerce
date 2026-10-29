import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as Security from "@curtiz/security";

const mocks = vi.hoisted(() => ({ client: vi.fn(), assurance: vi.fn(), roles: ["admin"], status: "active" }));
vi.mock("@/lib/internal-mfa", () => import("./internal-mfa"));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("./supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/technical-sanitizer", () => import("./technical-sanitizer"));
vi.mock("@/lib/public-media", () => import("./public-media"));
vi.mock("@/lib/postgres-uuid", () => import("./postgres-uuid"));
vi.mock("@/lib/operational-order-status", () => import("./operational-order-status"));
vi.mock("@curtiz/security", async (importOriginal) => ({
  ...await importOriginal<typeof Security>(),
  verifyDemoSession: () => null
}));
import { authorizeAdminRequest } from "./admin-api";
import { authorizeManagerRequest } from "./manager-api";
import { authorizeTechnicalRequest } from "./technical-api";
import { GET as readOperations, POST as changeOperations } from "../app/api/operations/route";
import { GET as readProducts, PATCH as changeProducts, DELETE as deleteProducts } from "../app/api/catalog/products/route";
import { GET as readNavigation, PATCH as changeNavigation } from "../app/api/admin/store-navigation/route";

beforeEach(() => {
  vi.stubEnv("REQUIRE_INTERNAL_MFA", "true");
  mocks.status = "active";
  mocks.assurance.mockResolvedValue({ data: { currentLevel: "aal1" }, error: null });
  mocks.client.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "test-user" } }, error: null }), mfa: { getAuthenticatorAssuranceLevel: mocks.assurance } },
    from: (table: string) => ({ select: () => ({ eq: () => table === "profiles"
      ? { maybeSingle: async () => ({ data: { status: mocks.status }, error: null }) }
      : Promise.resolve({ data: mocks.roles.map((role) => ({ role })), error: null }) }) })
  });
});

describe("API operacional", () => {
  it.each(["admin", "manager"])("requires configured MFA when reviewing returns as %s", async role => {
    mocks.roles = [role];
    mocks.assurance.mockClear();
    expect((await readOperations(new NextRequest("http://localhost:3001/api/operations?section=devolucoes"))).status).toBe(403);
    expect(mocks.assurance).toHaveBeenCalledTimes(1);
  });
  it("nega leitura e escrita com perfil suspenso", async () => {
    mocks.roles = ["operational"];
    mocks.status = "suspended";
    expect((await readOperations(new NextRequest("http://localhost:3001/api/operations"))).status).toBe(403);
    expect((await changeOperations(new NextRequest("http://localhost:3001/api/operations", { method: "POST",
      headers: { origin: "http://localhost:3001" } }))).status).toBe(403);
    expect(mocks.assurance).not.toHaveBeenCalled();
  });
});
describe("API de produtos", () => {
  it("nega leitura, edição e exclusão com perfil suspenso", async () => {
    mocks.roles = ["admin"];
    mocks.status = "suspended";
    const url = "http://localhost:3001/api/catalog/products";
    expect((await readProducts(new NextRequest(url))).status).toBe(401);
    expect((await changeProducts(new NextRequest(url, { method: "PATCH", headers: { origin: new URL(url).origin } }))).status).toBe(401);
    expect((await deleteProducts(new NextRequest(url, { method: "DELETE", headers: { origin: new URL(url).origin } }))).status).toBe(401);
    expect(mocks.assurance).not.toHaveBeenCalled();
  });
});
describe("API de navegação da loja", () => {
  it("nega leitura e escrita com perfil suspenso", async () => {
    mocks.roles = ["admin"];
    mocks.status = "suspended";
    const url = "http://localhost:3001/api/admin/store-navigation";
    expect((await readNavigation(new NextRequest(url))).status).toBe(401);
    expect((await changeNavigation(new NextRequest(url, { method: "PATCH",
      headers: { origin: "http://localhost:3001", "sec-fetch-site": "same-origin" } }))).status).toBe(401);
  });
});
afterEach(() => vi.unstubAllEnvs());

describe.each([
  ["admin", authorizeAdminRequest],
  ["manager", authorizeManagerRequest],
  ["technical", authorizeTechnicalRequest]
] as const)("autorização %s", (role, authorize) => {
  const request = new NextRequest("http://localhost:3001/api/test");
  beforeEach(() => { mocks.roles = [role]; });
  it("nega acesso sem sessão autenticada", async () => {
    mocks.client.mockResolvedValue(null);
    expect(await authorize(request)).toBeNull();
  });
  it("autoriza sessão ativa com o papel permitido", async () => {
    mocks.assurance.mockResolvedValue({ data: { currentLevel: "aal2" }, error: null });
    expect(await authorize(request)).toMatchObject({ userId: "test-user" });
  });
  it("autoriza sem consultar o autenticador removido", async () => {
    vi.stubEnv("REQUIRE_INTERNAL_MFA", "false");
    expect(await authorize(request)).toMatchObject({ userId: "test-user" });
  });
  it("sessão não substitui papel ou status", async () => {
    mocks.assurance.mockResolvedValue({ data: { currentLevel: "aal2" }, error: null });
    mocks.roles = ["customer", "representative"];
    expect(await authorize(request)).toBeNull();
    mocks.roles = [role];
    mocks.status = "suspended";
    expect(await authorize(request)).toBeNull();
  });
});
