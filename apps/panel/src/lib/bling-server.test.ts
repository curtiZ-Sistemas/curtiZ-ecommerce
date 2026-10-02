import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ technical: vi.fn(), user: vi.fn(), mfa: vi.fn(), demo: vi.fn(), profile: vi.fn(),
  roles: vi.fn<() => Promise<{ data: { role: string }[] | null; error: Error | null }>>(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./technical-api", () => ({ authorizeTechnicalRequest: state.technical }));
vi.mock("./internal-mfa", () => ({ hasRequiredInternalMfa: state.mfa }));
vi.mock("@curtiz/security", () => ({ DEMO_SESSION_COOKIE: "demo", verifyDemoSession: state.demo }));
vi.mock("./supabase/server", () => ({ createServerSupabaseClient: () => ({ auth: { getUser: state.user },
  from: (table: string) => ({ select: () => ({ eq: () => table === "profiles" ? { maybeSingle: state.profile } : state.roles() }) }) }) }));
import { authorizeBlingPanelRequest, authorizeBlingTechnicalRequest } from "./bling-server";
const request = () => new NextRequest("https://panel.example/api/integrations/bling/catalog");
beforeEach(() => {
  vi.clearAllMocks();
  state.user.mockResolvedValue({ data: { user: { id: "actor-test" } }, error: null });
  state.mfa.mockResolvedValue(true);
  state.demo.mockReturnValue(false);
  state.profile.mockResolvedValue({ data: { status: "active" }, error: null });
  state.roles.mockResolvedValue({ data: [{ role: "operational" }], error: null });
  state.technical.mockResolvedValue({ supabase: { rpc: state.rpc } });
  state.rpc.mockResolvedValue({ data: true, error: null });
});
describe("Bling panel authorization", () => {
  it("accepts an active internal session with applicable MFA", async () => {
    expect(await authorizeBlingPanelRequest(request())).not.toBeNull();
  });
  it("rejects demo sessions before accessing the database", async () => {
    state.demo.mockReturnValue(true);
    expect(await authorizeBlingPanelRequest(request())).toBeNull();
    expect(state.user).not.toHaveBeenCalled();
  });
  it("rejects missing authentication and MFA", async () => {
    state.user.mockResolvedValue({ data: { user: null }, error: null });
    expect(await authorizeBlingPanelRequest(request())).toBeNull();
    state.user.mockResolvedValue({ data: { user: { id: "actor-test" } }, error: null });
    state.mfa.mockResolvedValue(false);
    expect(await authorizeBlingPanelRequest(request())).toBeNull();
  });
  it("rejects inactive profiles, customers and failed role queries", async () => {
    state.profile.mockResolvedValue({ data: { status: "suspended" }, error: null });
    expect(await authorizeBlingPanelRequest(request())).toBeNull();
    state.profile.mockResolvedValue({ data: { status: "active" }, error: null });
    state.roles.mockResolvedValue({ data: [{ role: "customer" }], error: null });
    expect(await authorizeBlingPanelRequest(request())).toBeNull();
    state.roles.mockResolvedValue({ data: null, error: new Error("storage") });
    expect(await authorizeBlingPanelRequest(request())).toBeNull();
  });
  it("requires the integration permission in addition to technical authorization", async () => {
    state.rpc.mockResolvedValue({ data: false, error: null });
    expect(await authorizeBlingTechnicalRequest(request())).toBeNull();
    state.rpc.mockResolvedValue({ data: true, error: new Error("storage") });
    expect(await authorizeBlingTechnicalRequest(request())).toBeNull();
    state.rpc.mockResolvedValue({ data: true, error: null });
    expect(await authorizeBlingTechnicalRequest(request())).not.toBeNull();
    expect(state.rpc).toHaveBeenCalledWith("has_permission", { permission_code: "technical.integrations.manage" });
  });
});
