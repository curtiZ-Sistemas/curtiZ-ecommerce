import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";
import { publicBudgetResponse } from "../../../lib/public-request";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("../../../lib/public-request", () => ({ publicBudgetResponse: vi.fn() }));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => true, corsHeadersFor: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn(), createServiceSupabaseClient: vi.fn() }));
vi.mock("@/lib/help-content", () => ({ helpCategories: [], searchBuiltInHelp: () => [] }));
vi.mock("@/lib/unknown-data", () => ({ isUnknownRecord: () => false, readNumber: () => 0, readQueryResult: () => ({}), readRows: () => [], readString: () => "" }));

const id = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const request = () => new Request("https://curtiz.com.br/api/help", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "feedback", contentId: id, sessionId: id, helpful: true })
}) as NextRequest;
const actor = (visible: boolean, authError: { name: string } | null = null) => ({
  from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: visible ? { id } : null, error: null }) }) }) })),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: authError ? null : { id: userId } }, error: authError }) }
});

describe("help feedback", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.mocked(publicBudgetResponse).mockReset().mockResolvedValue(null);
    vi.mocked(createServerSupabaseClient).mockReset();
    vi.mocked(createServiceSupabaseClient).mockReset();
  });
  it("denies hidden content before creating the privileged client", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(actor(false) as never);
    expect((await POST(request())).status).toBe(404);
    expect(createServiceSupabaseClient).not.toHaveBeenCalled();
  });
  it("uses the validated user ID for feedback", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(actor(true) as never);
    vi.mocked(createServiceSupabaseClient).mockReturnValue({ rpc } as never);
    expect((await POST(request())).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("record_help_feedback_server", expect.objectContaining({ p_content_id: id, p_user_id: userId }));
  });
  it("fails closed when identity verification is unavailable", async () => {
    const rpc = vi.fn();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(actor(true, { name: "AuthRetryableFetchError" }) as never);
    vi.mocked(createServiceSupabaseClient).mockReturnValue({ rpc } as never);
    expect((await POST(request())).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("preserves anonymous feedback when no session exists", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(actor(true, { name: "AuthSessionMissingError" }) as never);
    vi.mocked(createServiceSupabaseClient).mockReturnValue({ rpc } as never);
    expect((await POST(request())).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("record_help_feedback_server", expect.objectContaining({ p_user_id: null }));
  });
  it("denies requests over the limit before any database access", async () => {
    vi.mocked(publicBudgetResponse).mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await POST(request())).status).toBe(429);
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });
});
