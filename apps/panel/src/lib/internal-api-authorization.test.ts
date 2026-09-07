import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as Security from "@curtiz/security";

const mocks = vi.hoisted(() => ({ client: vi.fn(), assurance: vi.fn(), roles: ["admin"], status: "active" }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("./supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/technical-sanitizer", () => import("./technical-sanitizer"));
vi.mock("@/lib/internal-mfa", () => import("./internal-mfa"));
vi.mock("@/lib/public-media", () => import("./public-media"));
vi.mock("@/lib/postgres-uuid", () => import("./postgres-uuid"));
vi.mock("@curtiz/security", async (importOriginal) => ({
  ...await importOriginal<typeof Security>(),
  verifyDemoSession: () => null
}));
import { authorizeAdminRequest } from "./admin-api";
import { authorizeManagerRequest } from "./manager-api";
import { authorizeTechnicalRequest } from "./technical-api";
import { GET as readOperations, POST as changeOperations } from "../app/api/operations/route";
import { GET as readProducts, PATCH as changeProducts, DELETE as deleteProducts } from "../app/api/catalog/products/route";

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
  it("nega leitura e escrita sem segundo fator", async () => {
    mocks.roles = ["operational"];
    mocks.assurance.mockClear();
    expect((await readOperations(new NextRequest("http://localhost:3001/api/operations"))).status).toBe(403);
    expect((await changeOperations(new NextRequest("http://localhost:3001/api/operations", { method: "POST" }))).status).toBe(403);
    expect(mocks.assurance).toHaveBeenCalledTimes(2);
  });
});
describe("API de produtos", () => {
  it("nega leitura, edição e exclusão sem segundo fator", async () => {
    mocks.roles = ["admin"];
    mocks.assurance.mockClear();
    const url = "http://localhost:3001/api/catalog/products";
    expect((await readProducts(new NextRequest(url))).status).toBe(401);
    expect((await changeProducts(new NextRequest(url, { method: "PATCH" }))).status).toBe(401);
    expect((await deleteProducts(new NextRequest(url, { method: "DELETE" }))).status).toBe(401);
    expect(mocks.assurance).toHaveBeenCalledTimes(3);
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
  it("nega sessão válida sem segundo fator", async () => {
    expect(await authorize(request)).toBeNull();
  });
  it("autoriza sessão com segundo fator", async () => {
    mocks.assurance.mockResolvedValue({ data: { currentLevel: "aal2" }, error: null });
    expect(await authorize(request)).toMatchObject({ userId: "test-user" });
  });
  it("preserva configuração desabilitada", async () => {
    vi.stubEnv("REQUIRE_INTERNAL_MFA", "false");
    expect(await authorize(request)).toMatchObject({ userId: "test-user" });
  });
  it("MFA não substitui papel ou status", async () => {
    mocks.assurance.mockResolvedValue({ data: { currentLevel: "aal2" }, error: null });
    mocks.roles = ["customer", "representative"];
    expect(await authorize(request)).toBeNull();
    mocks.roles = [role];
    mocks.status = "suspended";
    expect(await authorize(request)).toBeNull();
  });
});
