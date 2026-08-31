import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { GET, POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn()
}));

const mockedClient = vi.mocked(createServerSupabaseClient);

function request(categories: Record<string, boolean>) {
  return new NextRequest("https://store.example.com/api/privacy/cookies", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://store.example.com"
    },
    body: JSON.stringify({
      id: "11111111-1111-4111-8111-111111111111",
      policyVersion: "inventory-1",
      categories,
      origin: "banner",
      revoked: false
    })
  });
}

describe("cookie preferences API", () => {
  beforeEach(() => {
    mockedClient.mockReset();
  });

  it("permite somente a rejeição segura quando o registro remoto está indisponível", async () => {
    mockedClient.mockResolvedValue(null);

    const response = await POST(request({ essential: true }));
    const payload = (await response.json()) as { persisted: boolean; message: string };

    expect(response.status).toBe(200);
    expect(payload.persisted).toBe(false);
    expect(payload.message).toContain("opcionais permanecem desativados");
    expect(response.headers.get("set-cookie")).toContain("curtiz-cookie-preferences=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain("curtiz_referral=");
  });

  it("mantém um inventário real quando o banco está temporariamente indisponível", async () => {
    mockedClient.mockResolvedValue(null);

    const response = await GET();
    const payload = (await response.json()) as {
      categories: Array<{ id: string }>;
      cookies: Array<{ name_pattern: string; storage_type: string }>;
      policyVersion: string;
    };

    expect(payload.categories.map((category) => category.id)).toEqual(
      expect.arrayContaining(["essential", "preferences", "analytics"])
    );
    expect(payload.cookies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name_pattern: "curtiz:intelligence-session",
          storage_type: "session_storage"
        })
      ])
    );
    expect(payload.policyVersion).toBe("inventory-2");
  });

  it("informa quando o consentimento também foi persistido", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    mockedClient.mockResolvedValue({ rpc } as never);

    const response = await POST(request({ essential: true, functional: true }));
    const payload = (await response.json()) as { persisted: boolean };

    expect(response.status).toBe(200);
    expect(payload.persisted).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "record_cookie_consent",
      expect.objectContaining({
        p_categories: {
          essential: true,
          preferences: true,
          analytics: false,
          marketing: false
        }
      })
    );
  });

  it("não grava o cookie quando o RPC falha", async () => {
    mockedClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ error: { message: "unavailable" } })
    } as never);
    const response = await POST(request({ essential: true, analytics: true }));
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("mantém a rejeição segura quando o cliente remoto lança erro de rede", async () => {
    mockedClient.mockResolvedValue({
      rpc: vi.fn().mockRejectedValue(new Error("network"))
    } as never);
    const response = await POST(request({ essential: true, analytics: false }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("curtiz-cookie-preferences=");
  });

  it("continua rejeitando preferências sem o cookie essencial", async () => {
    const response = await POST(request({ essential: false }));
    expect(response.status).toBe(400);
    expect(mockedClient).not.toHaveBeenCalled();
  });
});
