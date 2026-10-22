import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), log: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: state.rpc }) }));
vi.mock("@curtiz/security", () => ({ logServerEvent: state.log }));
import { runEmailHomologation, runTransactionalEmailJobs } from "./transactional-email-jobs";
const now = Date.parse("2026-10-12T12:05:00.000Z");
const environment = { EMAIL_PROVIDER: "resend", EMAIL_ENABLED: "false", RESEND_API_KEY: "test-provider-key",
  EMAIL_FROM: "pedidos@example.com", EMAIL_REPLY_TO: "reply@example.com", NEXT_PUBLIC_STORE_URL: "https://store.example.com",
  EMAIL_HOMOLOGATION_RECIPIENT: "sistemas.curtiz@gmail.com", EMAIL_HOMOLOGATION_STARTED_AT: "2026-10-12T12:00:00.000Z" };
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("isolated runtime email homologation", () => {
  it.each([
    { EMAIL_ENABLED: "true" }, { EMAIL_ENABLED: "" }, { EMAIL_PROVIDER: "disabled" }, { RESEND_API_KEY: "" },
    { EMAIL_HOMOLOGATION_RECIPIENT: "" }, { EMAIL_HOMOLOGATION_RECIPIENT: "one@example.com" },
    { EMAIL_HOMOLOGATION_RECIPIENT: "one@example.com,two@example.com" },
    { EMAIL_HOMOLOGATION_STARTED_AT: "invalid" }, { EMAIL_HOMOLOGATION_STARTED_AT: "2026-10-12T12:06:00.000Z" },
    { EMAIL_HOMOLOGATION_STARTED_AT: "2026-10-12T11:50:00.000Z" }
  ])("does no work without explicit safe test configuration: %j", async override => {
    const transport = vi.fn<typeof fetch>();
    await runEmailHomologation({ ...environment, ...override }, "execution", transport, now);
    expect(transport).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("sends two labelled examples to one configured recipient and reads receipts", async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Response(JSON.stringify(
      init?.method === "POST" ? { id: "provider-test" } : { id: "provider-test", last_event: "delivered" })));
    const first = runEmailHomologation(environment, "one", transport, now);
    await vi.runAllTimersAsync();
    await first;
    const posts = transport.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(transport.mock.calls.filter(([, init]) => init?.method === "GET")).toHaveLength(2);
    for (const [, init] of posts) {
      if (typeof init?.body !== "string") throw new Error("Expected a serialized email payload");
      const payload: unknown = JSON.parse(init.body);
      expect(payload).toMatchObject({ to: ["sistemas.curtiz@gmail.com"], reply_to: "reply@example.com" });
      expect(JSON.stringify(payload)).toContain("HOMOLOGAÃ‡ÃƒO â€” SEM PEDIDO REAL");
      expect(JSON.stringify(payload)).toContain("NÃ£o existe pedido, pagamento");
    }
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.log).toHaveBeenCalledWith("info", "transactional_email_homologation_checked", expect.objectContaining({ lastEvent: "delivered" }));
    expect(JSON.stringify(state.log.mock.calls)).not.toMatch(/sistemas\.curtiz@gmail\.com|reply@|test-provider-key|<html/u);
    const second = runEmailHomologation(environment, "two", transport, now + 60_000);
    await vi.runAllTimersAsync();
    await second;
    const repeats = transport.mock.calls.filter(([, init]) => init?.method === "POST").slice(2);
    expect(repeats.map(([, init]) => init?.headers)).toEqual(posts.map(([, init]) => init?.headers));
    expect(repeats.map(([, init]) => init?.body)).toEqual(posts.map(([, init]) => init?.body));
  });
  it("reports provider failure without request, secret or response details", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error("sensitive transport details"));
    await runEmailHomologation(environment, "execution", transport, now);
    expect(state.log).toHaveBeenCalledWith("error", "transactional_email_homologation_failed", expect.objectContaining({ code: "email_acceptance_uncertain" }));
    expect(JSON.stringify(state.log.mock.calls)).not.toMatch(/sensitive|sistemas\.curtiz@gmail\.com|test-provider-key/u);
  });

  it("completes the explicit test before a database failure without claiming customer jobs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    state.rpc.mockResolvedValue({ data: null, error: { code: "test_storage_failure" } });
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Response(JSON.stringify(
      init?.method === "POST" ? { id: "provider-test" } : { last_event: "delivered" })));
    const result = runTransactionalEmailJobs({ ...environment, SUPABASE_URL: "https://test.supabase.co", SUPABASE_SECRET_KEY: "test-only-key" }, "execution", 4, transport);
    const failed = expect(result).rejects.toMatchObject({ code: "email_storage_unavailable" });
    await vi.runAllTimersAsync();
    await failed;
    expect(transport.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
    expect(transport.mock.calls.filter(([, init]) => init?.method === "GET")).toHaveLength(2);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc).toHaveBeenCalledWith("sync_transactional_email_runtime", { p_enabled: false, p_configured: false });
    expect(state.rpc).not.toHaveBeenCalledWith("claim_transactional_email", expect.anything());
  });
});

