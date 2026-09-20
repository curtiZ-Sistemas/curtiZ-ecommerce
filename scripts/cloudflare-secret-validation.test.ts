import { describe, expect, it } from "vitest";
import { missingCloudflareSecrets, requiredCloudflareSecrets } from "./cloudflare-secret-validation";

describe("Cloudflare secret validation", () => {
  it("requires only baseline server secrets while integrations are disabled", () => {
    expect(requiredCloudflareSecrets({
      PAYMENT_PROVIDER: "disabled", MERCADO_PAGO_ENABLED: "false",
      EMAIL_PROVIDER: "disabled", EMAIL_ENABLED: "false", TURNSTILE_ENABLED: "false"
    })).toEqual(["ACCOUNT_DELETION_HMAC_KEY", "AUDIT_HASH_KEY", "PII_ENCRYPTION_KEY",
      "RATE_LIMIT_HMAC_KEY", "REFERRAL_ATTRIBUTION_HMAC_KEY", "SUPABASE_SECRET_KEY"]);
  });

  it("não exige secrets exclusivos da loja no Worker do painel", () => {
    expect(requiredCloudflareSecrets({ DEPLOY_TARGET: "panel", PAYMENT_PROVIDER: "disabled" }))
      .toEqual(["AUDIT_HASH_KEY", "PII_ENCRYPTION_KEY", "SUPABASE_SECRET_KEY"]);
  });

  it("requires enabled integration secrets without inspecting their contents", () => {
    const environment = {
      PAYMENT_PROVIDER: "mercadopago", MERCADO_PAGO_ENABLED: "true",
      EMAIL_PROVIDER: "disabled", EMAIL_ENABLED: "false", TURNSTILE_ENABLED: "true"
    };
    expect(missingCloudflareSecrets([
      { name: "SUPABASE_SECRET_KEY" }, { name: "ACCOUNT_DELETION_HMAC_KEY" },
      { name: "PII_ENCRYPTION_KEY" }, { name: "AUDIT_HASH_KEY" },
      { name: "RATE_LIMIT_HMAC_KEY" }, { name: "REFERRAL_ATTRIBUTION_HMAC_KEY" }
    ], environment)).toEqual(["MERCADO_PAGO_ACCESS_TOKEN", "MERCADO_PAGO_WEBHOOK_SECRET", "TURNSTILE_SECRET_KEY"]);
  });

  it("exige OAuth, criptografia e um documento de origem quando o Melhor Envio está ativo", () => {
    const environment = { DEPLOY_TARGET: "panel", SHIPPING_PROVIDER: "melhorenvio", MELHOR_ENVIO_ENABLED: "true" };
    expect(missingCloudflareSecrets([
      { name: "SUPABASE_SECRET_KEY" }, { name: "PII_ENCRYPTION_KEY" }, { name: "AUDIT_HASH_KEY" },
      { name: "MELHOR_ENVIO_CLIENT_SECRET" }, { name: "MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY" },
      { name: "MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT" }
    ], environment)).toEqual([]);
  });
});
