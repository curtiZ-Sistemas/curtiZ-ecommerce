import { describe, expect, it } from "vitest";
import { missingCloudflareSecrets, requiredCloudflareSecrets } from "./cloudflare-secret-validation";

describe("Cloudflare secret validation", () => {
  it("requires only baseline server secrets while integrations are disabled", () => {
    expect(requiredCloudflareSecrets({
      PAYMENT_PROVIDER: "disabled", MERCADO_PAGO_ENABLED: "false",
      EMAIL_PROVIDER: "disabled", EMAIL_ENABLED: "false", TURNSTILE_ENABLED: "false"
    })).toEqual(["AUDIT_HASH_KEY", "PII_ENCRYPTION_KEY", "SUPABASE_SECRET_KEY"]);
  });

  it("requires enabled integration secrets without inspecting their contents", () => {
    const environment = {
      PAYMENT_PROVIDER: "mercadopago", MERCADO_PAGO_ENABLED: "true",
      EMAIL_PROVIDER: "disabled", EMAIL_ENABLED: "false", TURNSTILE_ENABLED: "true"
    };
    expect(missingCloudflareSecrets([
      { name: "SUPABASE_SECRET_KEY" }, { name: "PII_ENCRYPTION_KEY" }, { name: "AUDIT_HASH_KEY" }
    ], environment)).toEqual(["MERCADO_PAGO_ACCESS_TOKEN", "MERCADO_PAGO_WEBHOOK_SECRET", "TURNSTILE_SECRET_KEY"]);
  });
});
