import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { verifyConsentToken } from "../../../../lib/privacy/consent-token";
import { cookiePolicyVersion } from "../../../../lib/privacy/cookie-inventory";
import { GET, POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn()
}));

const mockedClient = vi.mocked(createServerSupabaseClient);

const consentId = "11111111-1111-4111-8111-111111111111";
const signingKey = "k".repeat(40);

function request(categories: Record<string, boolean>, overrides: { origin?: string; policyVersion?: string } = {}) {
  return new NextRequest("https://store.example.com/api/privacy/cookies", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: overrides.origin ?? "https://store.example.com"
    },
    body: JSON.stringify({
      id: consentId,
      policyVersion: overrides.policyVersion ?? cookiePolicyVersion(null),
      categories,
      origin: "banner",
      revoked: false
    })
  });
}

function consentCookie(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  const match = /curtiz-cookie-preferences=([^;]*)/u.exec(header);
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

describe("cookie preferences API", () => {
  beforeEach(() => {
    mockedClient.mockReset();
    process.env.COOKIE_CONSENT_HMAC_KEY = signingKey;
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
    expect(payload.policyVersion).toBe(cookiePolicyVersion(null));
    expect(payload).toMatchObject({ policyVersionKnown: false });
    expect(payload.cookies).toEqual(expect.arrayContaining([
      expect.objectContaining({ name_pattern: "SDK de pagamento Mercado Pago", category_id: "essential", first_party: false }),
      expect.objectContaining({ name_pattern: "curtiz-auth-session", storage_type: "session_storage" })
    ]));
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

  it("assina no cookie httpOnly somente a escolha registrada", async () => {
    mockedClient.mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ error: null }) } as never);
    const response = await POST(request({ essential: true, analytics: true }));
    expect(response.status).toBe(200);
    expect(verifyConsentToken(consentCookie(response), signingKey)).toMatchObject({
      id: consentId,
      categories: { essential: true, preferences: false, analytics: true, marketing: false }
    });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
  });

  it("sem chave de assinatura o servidor não reconhece opcionais (falha fechada)", async () => {
    delete process.env.COOKIE_CONSENT_HMAC_KEY;
    const previousRateKey = process.env.RATE_LIMIT_HMAC_KEY;
    const previousDemo = process.env.DEMO_SESSION_SECRET;
    delete process.env.RATE_LIMIT_HMAC_KEY;
    delete process.env.DEMO_SESSION_SECRET;
    mockedClient.mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ error: null }) } as never);
    const response = await POST(request({ essential: true, analytics: true }));
    expect(response.status).toBe(200);
    expect(consentCookie(response)).toBe("");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    if (previousRateKey !== undefined) process.env.RATE_LIMIT_HMAC_KEY = previousRateKey;
    if (previousDemo !== undefined) process.env.DEMO_SESSION_SECRET = previousDemo;
  });

  it("não altera a escolha de outra conta: registra um novo identificador", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ error: { code: "42501", message: "cookie consent belongs to another account" } })
      .mockResolvedValueOnce({ error: null });
    mockedClient.mockResolvedValue({ rpc } as never);
    const response = await POST(request({ essential: true, analytics: true }));
    const payload = (await response.json()) as { id: string; persisted: boolean };
    expect(response.status).toBe(200);
    expect(payload.persisted).toBe(true);
    expect(payload.id).not.toBe(consentId);
    expect(rpc).toHaveBeenLastCalledWith("record_cookie_consent", expect.objectContaining({ p_id: payload.id }));
    expect(verifyConsentToken(consentCookie(response), signingKey)?.id).toBe(payload.id);
  });

  it.each([
    ["origem de outro site", { origin: "https://attacker.example" }],
    ["versão de política malformada", { policyVersion: "<script>alert(1)</script>" }]
  ])("recusa %s", async (_label, overrides) => {
    const response = await POST(request({ essential: true, analytics: true }, overrides));
    expect([400, 403]).toContain(response.status);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mockedClient).not.toHaveBeenCalled();
  });

  it("recusa categorias desconhecidas", async () => {
    const response = await POST(request({ essential: true, tracking: true }));
    expect(response.status).toBe(400);
    expect(mockedClient).not.toHaveBeenCalled();
  });

  it("continua rejeitando preferências sem o cookie essencial", async () => {
    const response = await POST(request({ essential: false }));
    expect(response.status).toBe(400);
    expect(mockedClient).not.toHaveBeenCalled();
  });
});
