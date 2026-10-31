import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { encryptPII, decryptPII } from "../../../../lib/pii";
import { POST } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn(), createServiceSupabaseClient: vi.fn() }));
vi.mock("@/lib/http-origin", () => import("../../../../lib/http-origin"));
const request = (body: unknown = { cpf: "123.456.789-09" }, origin = "https://loja.example") =>
  new Request("https://loja.example/api/customer/cpf", { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PII_ENCRYPTION_KEY", "isolated-cpf-update-key-32-bytes-long");
  vi.mocked(createServerSupabaseClient).mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({
    data: { user: { id: "customer-one" } }, error: null
  }) } } as never);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("CPF update endpoint", () => {
  it("updates only the authenticated customer and returns only last4", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    vi.mocked(createServiceSupabaseClient).mockReturnValue({ rpc } as never);
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(await result.json()).toEqual({ ok: true, cpfLastFour: "8909" });
    const calls = rpc.mock.calls as Array<[string, Record<string, unknown>]>;
    const args = calls[0]?.[1];
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(args).toMatchObject({ p_customer_id: "customer-one", p_cpf_last_four: "8909" });
    const ciphertext = args?.p_cpf_ciphertext;
    expect(ciphertext).toMatch(/^v1\./u);
    if (typeof ciphertext !== "string") throw new Error("Expected encrypted customer identity");
    expect(decryptPII(ciphertext)).toBe("12345678909");
  });
  it("preserves old identity on RPC failure and never exposes private data in errors/logs", async () => {
    const oldCiphertext = encryptPII("52998224725");
    const error = { message: `12345678909 ${oldCiphertext} ${process.env.PII_ENCRYPTION_KEY}` };
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    vi.mocked(createServiceSupabaseClient).mockReturnValue({ rpc } as never);
    const logs = ["error", "warn", "log"] as const;
    const spies = logs.map(name => vi.spyOn(console, name).mockImplementation(() => {}));
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ message: "Não foi possível salvar o CPF agora." });
    expect(rpc).toHaveBeenCalledTimes(1);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(decryptPII(oldCiphertext)).toBe("52998224725");
  });
  it.each(["", "11111111111", "12345678900", "abc52998224725"])("rejects invalid CPF before writing", async cpf => {
    const rpc = vi.fn(); vi.mocked(createServiceSupabaseClient).mockReturnValue({ rpc } as never);
    expect((await POST(request({ cpf }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not allow the client to choose a different customer", async () => {
    expect((await POST(request({ cpf: "12345678909", customerId: "customer-two" }))).status).toBe(400);
    expect(createServiceSupabaseClient).not.toHaveBeenCalled();
  });
  it("requires authentication and a valid origin", async () => {
    expect((await POST(request(undefined, "https://attacker.example"))).status).toBe(403);
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
    vi.mocked(createServerSupabaseClient).mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({
      data: { user: null }, error: null
    }) } } as never);
    expect((await POST(request())).status).toBe(401);
    expect(createServiceSupabaseClient).not.toHaveBeenCalled();
  });
});
