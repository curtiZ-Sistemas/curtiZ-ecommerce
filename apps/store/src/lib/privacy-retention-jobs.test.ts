import { afterEach, describe, expect, it, vi } from "vitest";
import { runPrivacyRetentionJobs } from "./privacy-retention-jobs";

vi.mock("server-only", () => ({}));
vi.mock("@curtiz/security", () => ({ logServerEvent: vi.fn() }));
import { logServerEvent } from "@curtiz/security";

const environment = { PRIVACY_RETENTION_ENABLED: "true", SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_fixture" };
afterEach(() => vi.clearAllMocks());

describe("privacy retention maintenance", () => {
  it("requires explicit activation before any deletion request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await runPrivacyRetentionJobs({}, "run", fetcher)).toMatchObject({ enabled: false, ok: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the bounded service-only RPC and reports counts without identifiers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ events: 500, profiles: 4, rateBuckets: 1 })));
    expect(await runPrivacyRetentionJobs(environment, "run", fetcher)).toEqual({ enabled: true, ok: true, events: 500, profiles: 4, rateBuckets: 1 });
    expect(fetcher).toHaveBeenCalledWith("https://project.supabase.co/rest/v1/rpc/purge_expired_intelligence_data", expect.objectContaining({
      method: "POST", body: JSON.stringify({ p_batch_size: 500 }), redirect: "error"
    }));
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("apikey")).toBe("sb_secret_fixture");
    expect(headers.has("authorization")).toBe(false);
    expect(JSON.stringify(vi.mocked(logServerEvent).mock.calls)).not.toContain("sb_secret_fixture");
  });

  it("supports a legacy server key without exposing it", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"events":0,"profiles":0,"rateBuckets":0}'));
    await runPrivacyRetentionJobs({ ...environment, SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "legacy-fixture" }, "run", fetcher);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer legacy-fixture");
    expect(JSON.stringify(vi.mocked(logServerEvent).mock.calls)).not.toContain("legacy-fixture");
  });

  it.each(["http://project.supabase.co", "https://secret@project.supabase.co", "https://project.supabase.co/path", "https://project.supabase.co?key=private"])('rejects an unsafe backend URL: %s', async url => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await runPrivacyRetentionJobs({ ...environment, SUPABASE_URL: url }, "run", fetcher)).toMatchObject({ ok: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([401,403,500])("does not retry failed maintenance (%s)", async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"message":"private detail"}', { status }));
    expect(await runPrivacyRetentionJobs(environment, "run", fetcher)).toMatchObject({ ok: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(logServerEvent).mock.calls)).not.toContain("private detail");
  });

  it.each([{events:501,profiles:0,rateBuckets:0},{events:-1,profiles:0,rateBuckets:0},{events:0,profiles:"0",rateBuckets:0},null])("rejects an invalid count response", async payload => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload)));
    expect(await runPrivacyRetentionJobs(environment, "run", fetcher)).toMatchObject({ ok: false });
  });

  it("isolates a timeout without logging exception details", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private transport detail"));
    expect(await runPrivacyRetentionJobs(environment, "run", fetcher)).toMatchObject({ ok: false });
    expect(JSON.stringify(vi.mocked(logServerEvent).mock.calls)).not.toContain("private transport detail");
  });

  it("stops reading an unexpectedly large response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(5000)));
    expect(await runPrivacyRetentionJobs(environment, "run", fetcher)).toMatchObject({ ok: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
