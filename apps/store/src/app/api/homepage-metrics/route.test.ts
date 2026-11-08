import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";
import { publicBudgetResponse } from "../../../lib/public-request";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { hasServerConsent } from "@/lib/privacy/consent-server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("../../../lib/public-request", () => ({ publicBudgetResponse: vi.fn() }));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: vi.fn() }));
vi.mock("@/lib/privacy/consent-server", () => ({ hasServerConsent: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: vi.fn() }));

const request = () => new Request("https://curtiz.com.br/api/homepage-metrics", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ versionId: "00000000-0000-4000-8000-000000000001", itemKey: "a", metric: "view", device: "mobile" })
}) as NextRequest;

describe("homepage metrics", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.mocked(publicBudgetResponse).mockReset().mockResolvedValue(null);
    vi.mocked(isAllowedRequestOrigin).mockReset().mockReturnValue(true);
    vi.mocked(hasServerConsent).mockReset().mockReturnValue(true);
    vi.mocked(createServiceSupabaseClient).mockReset();
  });
  it("does not create a privileged client when rate limited or without consent", async () => {
    vi.mocked(publicBudgetResponse).mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await POST(request())).status).toBe(429);
    vi.mocked(hasServerConsent).mockReturnValueOnce(false);
    expect((await POST(request())).status).toBe(403);
    expect(createServiceSupabaseClient).not.toHaveBeenCalled();
  });
  it("records validated metrics using the server-only client", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createServiceSupabaseClient).mockReturnValue({ rpc } as never);
    expect((await POST(request())).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("record_homepage_metric", {
      p_section_version_id: "00000000-0000-4000-8000-000000000001", p_item_key: "a", p_metric: "view", p_device: "mobile"
    });
  });
});
