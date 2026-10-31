import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@curtiz/security", () => ({ logServerEvent: vi.fn() }));
vi.mock("./melhor-envio-server", () => ({ createMelhorEnvioProvider: vi.fn() }));

import { runExpirationHousekeeping } from "./housekeeping";
import { runBlingJobs } from "./bling-jobs";
import { runMelhorEnvioShippingJobs } from "./melhor-envio-jobs";
import { runTransactionalEmailJobs } from "./transactional-email-jobs";
import { runAfterSaleJobs } from "./after-sale-jobs";
import { logServerEvent } from "@curtiz/security";

const environment = {
  SUPABASE_URL: "https://scheduled-test.supabase.co", SUPABASE_SECRET_KEY: "test-only-key",
  EMAIL_ENABLED: "false", EMAIL_PROVIDER: "resend",
  BLING_CLIENT_ID: "test-id", BLING_CLIENT_SECRET: "test-secret", BLING_TOKEN_ENCRYPTION_KEY: "test-key"
};

afterEach(() => vi.unstubAllGlobals());

describe("scheduled tasks with the real Supabase HTTP client", () => {
  it.each(["bling", "transactional_email"])("reports a sanitized RPC failure for %s", async (queue) => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({
      code: "PGRST202", message: "private fixture detail", details: "private fixture detail", hint: "private fixture detail"
    }, { status: 404 }));
    const run = queue === "bling" ? runBlingJobs : runTransactionalEmailJobs;
    await expect(run(environment, "test-execution", undefined, transport)).rejects.toBeInstanceOf(Error);
    expect(logServerEvent).toHaveBeenCalledWith("error", `${queue}_storage_request_failed`, {
      rpc: queue === "bling" ? "read_integration_credential" : "sync_transactional_email_runtime",
      status: 404, databaseCode: "PGRST202"
    });
    expect(JSON.stringify(vi.mocked(logServerEvent).mock.calls)).not.toContain("private fixture detail");
  });

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
    await expect(runAfterSaleJobs(environment, "test-execution", transport)).resolves.toMatchObject({ processed: 0 });
    await expect(runMelhorEnvioShippingJobs(environment, "test-execution", undefined, transport)).resolves.toMatchObject({ ok: true, processed: 0 });
    await expect(runTransactionalEmailJobs(environment, "test-execution", undefined, transport)).resolves.toMatchObject({ processed: 0 });
    expect(paths).toEqual([
      "/rest/v1/rpc/expire_stale_mercadopago_orders", "/rest/v1/rpc/read_integration_credential",
      "/rest/v1/rpc/claim_after_sale_job", "/rest/v1/rpc/claim_melhor_envio_fulfillment_job", "/rest/v1/rpc/sync_transactional_email_runtime",
      "/rest/v1/rpc/configure_transactional_email_test_scope"
    ]);
    expect(patchedFetch).not.toHaveBeenCalled();
  });
});

