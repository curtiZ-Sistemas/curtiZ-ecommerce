import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@curtiz/security", () => ({ logServerEvent: vi.fn() }));
vi.mock("./melhor-envio-server", () => ({ createMelhorEnvioProvider: vi.fn() }));

import { runExpirationHousekeeping } from "./housekeeping";
import { runBlingJobs } from "./bling-jobs";
import { runMelhorEnvioShippingJobs } from "./melhor-envio-jobs";
import { runTransactionalEmailJobs } from "./transactional-email-jobs";

const environment = {
  SUPABASE_URL: "https://scheduled-test.supabase.co", SUPABASE_SECRET_KEY: "test-only-key",
  EMAIL_ENABLED: "false", EMAIL_PROVIDER: "resend",
  BLING_CLIENT_ID: "test-id", BLING_CLIENT_SECRET: "test-secret", BLING_TOKEN_ENCRYPTION_KEY: "test-key"
};

afterEach(() => vi.unstubAllGlobals());

describe("scheduled tasks with the real Supabase HTTP client", () => {
  it("propagates a failed shipping claim instead of reporting an empty completed queue", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"code":"temporary_unavailable"}', { status: 503 }));
    await expect(runMelhorEnvioShippingJobs(environment, "test-execution", undefined, transport))
      .rejects.toMatchObject({ code: "provider_unavailable", httpStatus: 503, retryable: true });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("calls every queue RPC through the injected transport while global fetch rejects", async () => {
    const patchedFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("No Next request storage"));
    vi.stubGlobal("fetch", patchedFetch);
    const paths: string[] = [];
    const transport = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      paths.push(url.pathname);
      const data = url.pathname.endsWith("expire_stale_mercadopago_orders") ? 0
        : url.pathname.endsWith("sync_transactional_email_runtime") ? true : null;
      return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
    });
    await expect(runExpirationHousekeeping(environment, "test-execution", transport)).resolves.toMatchObject({ ok: true });
    await expect(runBlingJobs(environment, "test-execution", undefined, transport)).resolves.toMatchObject({ processed: 0 });
    await expect(runMelhorEnvioShippingJobs(environment, "test-execution", undefined, transport)).resolves.toMatchObject({ ok: true, processed: 0 });
    await expect(runTransactionalEmailJobs(environment, "test-execution", undefined, transport)).resolves.toMatchObject({ processed: 0 });
    expect(paths).toEqual([
      "/rest/v1/rpc/expire_stale_mercadopago_orders", "/rest/v1/rpc/read_integration_credential",
      "/rest/v1/rpc/claim_melhor_envio_job", "/rest/v1/rpc/sync_transactional_email_runtime"
    ]);
    expect(patchedFetch).not.toHaveBeenCalled();
  });
});
