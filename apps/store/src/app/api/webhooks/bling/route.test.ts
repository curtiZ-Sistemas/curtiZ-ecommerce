import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ rpc: vi.fn(), accepted: "accepted", credentialStatus: "connected" }));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: () => ({ rpc: state.rpc }) }));
import { POST } from "./route";

const envelope = () => ({ eventId: "test-event", event: "invoice.updated", companyId: "test-company", data: { id: 12 }, date: "2026-10-02T00:00:00Z", version: "1" });
const request = (payload = envelope(), signature?: string) => {
  const body = JSON.stringify(payload);
  return new Request("https://store.example/api/webhooks/bling", { method: "POST", body, headers: {
    "content-type": "application/json", "x-bling-signature-256": signature ?? `sha256=${createHmac("sha256", "test-secret").update(body).digest("hex")}`
  } });
};
beforeEach(() => {
  vi.stubEnv("BLING_CLIENT_SECRET", "test-secret");
  state.accepted = "accepted"; state.credentialStatus = "connected";
  state.rpc.mockReset().mockImplementation(async (name: string) => ({ data: name === "read_bling_account" ? { companyId: "test-company" }
    : name === "read_integration_credential" ? { status: state.credentialStatus } : state.accepted, error: null }));
});
afterEach(() => vi.unstubAllEnvs());
describe("Bling webhook persistence", () => {
  it("persists the signed raw payload before acknowledging without synchronous ERP calls", async () => {
    expect((await POST(request())).status).toBe(202);
    expect(state.rpc).toHaveBeenCalledWith("accept_bling_webhook", expect.objectContaining({ p_event_id: "test-event", p_resource_id: "12",
      p_company_id: "test-company", p_payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/u) as unknown }));
  });
  it("acknowledges duplicates and rejects conflicting reuse of the event ID", async () => {
    state.accepted = "duplicate";
    expect((await POST(request())).status).toBe(200);
    state.accepted = "conflict";
    expect((await POST(request())).status).toBe(409);
  });
  it("never acknowledges a failed database write", async () => {
    state.rpc.mockImplementation(async (name: string) => name === "accept_bling_webhook" ? { data: null, error: new Error("db") }
      : { data: name === "read_bling_account" ? { companyId: "test-company" } : { status: "connected" }, error: null });
    expect((await POST(request())).status).toBe(503);
  });
  it("rejects invalid signatures before database access", async () => {
    expect((await POST(request(envelope(), "sha256=" + "0".repeat(64)))).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rejects a different account even with the application's valid signature", async () => {
    expect((await POST(request({ ...envelope(), companyId: "another-company" }))).status).toBe(403);
    expect(state.rpc).not.toHaveBeenCalledWith("accept_bling_webhook", expect.anything());
  });
  it("retains future unknown events and out-of-order event timestamps", async () => {
    expect((await POST(request({ ...envelope(), event: "new_resource.future_action", date: "2020-01-01T00:00:00Z" }))).status).toBe(202);
  });
  it("retains authenticated events while credentials require reconnection", async () => {
    state.credentialStatus = "refresh_required";
    expect((await POST(request())).status).toBe(202);
  });
  it("rejects oversized signed bodies", async () => {
    expect((await POST(request({ ...envelope(), data: { id: 12, padding: "x".repeat(70000) } } as ReturnType<typeof envelope>))).status).toBe(413);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
