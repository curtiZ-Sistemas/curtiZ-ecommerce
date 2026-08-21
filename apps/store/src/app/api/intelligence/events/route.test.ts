import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { POST } from "./route";

vi.mock("../../../../lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn() }));
const client = vi.mocked(createServerSupabaseClient);
const id = "11111111-1111-4111-8111-111111111111";
const request = (events: unknown[], consent = true) =>
  new NextRequest("http://localhost:3000/api/intelligence/events", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      ...(consent
        ? {
            cookie: `curtiz-cookie-preferences=${encodeURIComponent(JSON.stringify({ essential: true, analytics: true }))}`
          }
        : {})
    },
    body: JSON.stringify({ sessionId: id, consent: true, events })
  });
const event = (type: string) => ({
  id,
  type,
  occurredAt: "2026-08-21T12:00:00.000Z",
  device: "mobile",
  path: "/produtos"
});

describe("intelligence event batches", () => {
  beforeEach(() => {
    client.mockReset();
    delete process.env.DEMO_MODE;
  });
  it("requires persisted analytics consent", async () => {
    const response = await POST(request([event("page_view")], false));
    expect(response.status).toBe(403);
    expect(client).not.toHaveBeenCalled();
  });
  it("rejects browser purchase events", async () => {
    const response = await POST(request([event("purchase")]));
    expect(response.status).toBe(400);
    expect(client).not.toHaveBeenCalled();
  });
  it("enforces the bounded batch size", async () => {
    const response = await POST(
      request(
        Array.from({ length: 21 }, (_, index) => ({
          ...event("page_view"),
          id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`
        }))
      )
    );
    expect(response.status).toBe(400);
  });
  it("forwards one sanitized batch to the database", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { accepted: 1, enabled: true }, error: null });
    client.mockResolvedValue({ rpc } as never);
    const response = await POST(request([event("page_view")]));
    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "ingest_intelligence_events",
      expect.objectContaining({ p_session_id: id, p_consent: true })
    );
  });
  it("maps database throttling to 429", async () => {
    client.mockResolvedValue({
      rpc: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: "intelligence rate limit exceeded" } })
    } as never);
    expect((await POST(request([event("page_view")]))).status).toBe(429);
  });
});
