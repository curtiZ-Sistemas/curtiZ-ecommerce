import { z } from "zod";

const booleanString = z
  .enum(["true", "false", "1", "0", "yes", "no"])
  .transform((value) => ["true", "1", "yes"].includes(value));

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_STORE_URL: z.string().url(),
  NEXT_PUBLIC_PANEL_URL: z.string().url(),
  NEXT_PUBLIC_STORE_TEST_URL: z.string().url().optional(),
  NEXT_PUBLIC_PANEL_TEST_URL: z.string().url().optional(),
  NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY: z.string().startsWith("TEST-").optional()
});

export const serverEnvSchema = z.object({
  SUPABASE_URL: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return url.pathname === "/" && !url.search && !url.hash;
    }, "Use somente a origem do projeto Supabase, sem caminhos"),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  PAYMENT_PROVIDER: z.enum(["disabled", "mock", "mercadopago", "mercado_pago"]).default("disabled"),
  SHIPPING_PROVIDER: z
    .enum(["disabled", "fixed", "mock", "melhorenvio", "melhor_envio", "correios", "custom"])
    .default("disabled"),
  EMAIL_PROVIDER: z.enum(["disabled", "mock", "resend"]).default("disabled"),
  WHATSAPP_PROVIDER: z.enum(["disabled", "mock", "meta"]).default("disabled"),
  AUTH_COOKIE_DOMAIN: z.string().min(3).optional(),
  AUTH_COOKIE_DOMAINS: z.string().min(3).optional(),
  STAGING_DEMO_HOSTS: z.string().optional(),
  DEMO_MODE: booleanString.default(false),
  ALLOW_GUEST_CHECKOUT: booleanString.default(false),
  REQUIRE_INTERNAL_MFA: booleanString.default(false),
  AUTH_RATE_LIMIT_ENABLED: booleanString.default(true),
  CHECKOUT_ENABLED: booleanString.default(false),
  MERCADO_PAGO_ENABLED: booleanString.default(false),
  MELHOR_ENVIO_ENABLED: booleanString.default(false),
  MELHOR_ENVIO_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  MELHOR_ENVIO_BASE_URL: z.string().url().optional(),
  MELHOR_ENVIO_REDIRECT_URI: z.string().url().optional(),
  MELHOR_ENVIO_CLIENT_ID: z.string().min(1).optional(),
  MELHOR_ENVIO_CLIENT_SECRET: z.string().min(1).optional(),
  MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
  MELHOR_ENVIO_APP_NAME: z.string().min(1).optional(),
  MELHOR_ENVIO_TECHNICAL_CONTACT: z.string().email().optional(),
  MELHOR_ENVIO_ORIGIN_POSTAL_CODE: z.string().regex(/^\d{8}$/).optional(),
  MELHOR_ENVIO_ORIGIN_NAME: z.string().min(1).optional(),
  MELHOR_ENVIO_ORIGIN_EMAIL: z.string().email().optional(),
  MELHOR_ENVIO_ORIGIN_PHONE: z.string().min(10).optional(),
  MELHOR_ENVIO_ORIGIN_DOCUMENT: z.string().optional(),
  MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT: z.string().optional(),
  MELHOR_ENVIO_ORIGIN_STATE_REGISTER: z.string().optional(),
  MELHOR_ENVIO_ORIGIN_CNAE: z.string().optional(),
  MELHOR_ENVIO_ORIGIN_ADDRESS: z.string().min(1).optional(),
  MELHOR_ENVIO_ORIGIN_NUMBER: z.string().min(1).optional(),
  MELHOR_ENVIO_ORIGIN_COMPLEMENT: z.string().optional(),
  MELHOR_ENVIO_ORIGIN_DISTRICT: z.string().min(1).optional(),
  MELHOR_ENVIO_ORIGIN_CITY: z.string().min(1).optional(),
  MELHOR_ENVIO_ORIGIN_STATE: z.string().length(2).optional(),
  MELHOR_ENVIO_WEBHOOK_CONFIGURED: booleanString.default(false),
  EMAIL_ENABLED: booleanString.default(false),
  TURNSTILE_ENABLED: booleanString.default(false),
  GOOGLE_MERCHANT_ENABLED: booleanString.default(false),
  INVENTORY_RESERVATION_MINUTES: z.coerce.number().int().min(5).max(120).default(30)
});

export * from "./integrations";
export * from "./public-urls";
