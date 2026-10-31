import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ roles: ["customer"], status: "active", userError: false, roleError: false, rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/auth-routing", () => import("./auth-routing"));
vi.mock("@/lib/customer-account-types", () => import("./customer-account-types"));
vi.mock("@/lib/customer-order-visibility", () => import("./customer-order-visibility"));
vi.mock("@/lib/unknown-data", () => import("./unknown-data"));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner", user_metadata: {}, created_at: "2026-01-01" } }, error: state.userError ? {} : null }) },
  rpc: state.rpc,
  from: (table: string) => {
    const result = () => table === "profiles" ? { data: { id: "owner", status: state.status }, error: null }
      : table === "user_roles" ? { data: state.roles.map(role => ({ role })), error: state.roleError ? {} : null } : { data: [], error: null };
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => query,
      maybeSingle: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return query;
  }
}) }));
import { loadCustomerAccount } from "./customer-account-data";

beforeEach(() => { state.roles = ["customer"]; state.status = "active"; state.userError = false; state.roleError = false;
  state.rpc.mockReset().mockResolvedValue({ data: [], error: null }); });
describe("customer area with independent internal roles", () => {
  it.each(["admin", "manager", "technical", "operational"])("loads personal account for %s without redirect", async role => {
    state.roles = ["customer", role];
    const result = await loadCustomerAccount();
    expect(result).toMatchObject({ authenticated: true, profile: { id: "owner" }, panelDestination: "/selecionar-painel" });
    expect(state.rpc).toHaveBeenCalledWith("list_my_visible_orders", { p_limit: 50 });
  });
  it("allows an internal-only active account to use its personal resources", async () => {
    state.roles = ["technical"];
    expect(await loadCustomerAccount()).toMatchObject({ authenticated: true, panelDestination: "/selecionar-painel" });
  });
  it("never shows panel entry to a customer or when role lookup fails", async () => {
    expect((await loadCustomerAccount()).panelDestination).toBe("");
    state.roles = ["admin"]; state.roleError = true;
    expect((await loadCustomerAccount()).panelDestination).toBe("");
  });
  it("does not expose account resources for expired or disabled identities", async () => {
    state.userError = true; expect((await loadCustomerAccount()).authenticated).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
    state.userError = false; state.status = "suspended";
    expect((await loadCustomerAccount()).authenticated).toBe(false);
  });
});
