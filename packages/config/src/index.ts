import { z } from "zod";

const booleanString = z
  .enum(["true", "false", "1", "0", "yes", "no"])
  .transform((value) => ["true", "1", "yes"].includes(value));

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_STORE_URL: z.string().url(),
  NEXT_PUBLIC_PANEL_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1)
});

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  PAYMENT_PROVIDER: z.enum(["disabled", "mock", "mercadopago", "mercado_pago"]).default("disabled"),
  SHIPPING_PROVIDER: z
    .enum(["disabled", "mock", "melhorenvio", "melhor_envio", "correios", "custom"])
    .default("disabled"),
  EMAIL_PROVIDER: z.enum(["disabled", "mock", "resend"]).default("disabled"),
  WHATSAPP_PROVIDER: z.enum(["disabled", "mock", "meta"]).default("disabled"),
  AUTH_COOKIE_DOMAIN: z.string().min(3).optional(),
  STAGING_DEMO_HOSTS: z.string().optional(),
  DEMO_MODE: booleanString.default(false),
  ALLOW_GUEST_CHECKOUT: booleanString.default(true),
  REQUIRE_INTERNAL_MFA: booleanString.default(false),
  CHECKOUT_ENABLED: booleanString.default(false),
  MERCADO_PAGO_ENABLED: booleanString.default(false),
  MELHOR_ENVIO_ENABLED: booleanString.default(false),
  EMAIL_ENABLED: booleanString.default(false),
  TURNSTILE_ENABLED: booleanString.default(false),
  INVENTORY_RESERVATION_MINUTES: z.coerce.number().int().min(5).max(120).default(30)
});

export * from "./integrations";
