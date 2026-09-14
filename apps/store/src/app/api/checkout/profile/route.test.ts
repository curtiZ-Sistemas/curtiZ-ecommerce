import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { encryptPII } from "../../../../lib/pii";
import { GET } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));
vi.mock("@curtiz/security", () => ({ DEMO_SESSION_COOKIE: "demo", verifyDemoSession: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn(), createServiceSupabaseClient: vi.fn() }));
vi.mock("@/lib/unknown-data", () => import("../../../../lib/unknown-data"));

const profile = { full_name: "Cliente Teste", phone: "11999999999", cpf_last_four: "4725" };
const address = { id: "11111111-1111-4111-8111-111111111111", label: "Casa", recipient_name: "Cliente Teste",
  postal_code: "01310100", street: "Avenida Paulista", number: "1000", complement: "", district: "Bela Vista",
  city: "São Paulo", state: "SP", is_default: true };

const publicClient = () => ({
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "customer-id", email: "cliente@example.com" } }, error: null }) },
  from: vi.fn((table: string) => {
    const result = table === "profiles" ? { data: profile, error: null } : { data: [address], error: null };
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      maybeSingle: () => Promise.resolve(result),
      limit: () => Promise.resolve(result)
    };
    return query;
  })
});

describe("checkout profile readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PII_ENCRYPTION_KEY", "isolated-checkout-profile-secret-32-bytes");
    vi.mocked(createServerSupabaseClient).mockResolvedValue(publicClient() as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("ignora last4 legado quando a identidade privada não existe", async () => {
    vi.mocked(createServiceSupabaseClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: null })
    } as never);
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile: { cpfConfigured: false, cpfLastFour: "" }
    });
  });

  it("confirma CPF somente pela identidade privada válida e não a expõe", async () => {
    const cpf = "52998224725";
    const ciphertext = encryptPII(cpf);
    vi.mocked(createServiceSupabaseClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: {
        customerId: "customer-id", cpfCiphertext: ciphertext, cpfLastFour: "4725"
      }, error: null })
    } as never);
    const response = await GET();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ profile: { cpfConfigured: true, cpfLastFour: "4725" } });
    expect(text).not.toContain(cpf);
    expect(text).not.toContain(ciphertext);
    expect(text).not.toContain("cpfCiphertext");
  });
});
