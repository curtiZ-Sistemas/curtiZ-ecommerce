import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_STORE_URL: z.string().url(),
  NEXT_PUBLIC_PANEL_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1)
});

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PAYMENT_PROVIDER: z.enum(["mock", "mercadopago"]).default("mock"),
  SHIPPING_PROVIDER: z.enum(["mock", "melhorenvio", "correios", "custom"]).default("mock"),
  EMAIL_PROVIDER: z.enum(["mock", "resend"]).default("mock"),
  DEMO_MODE: booleanString.default(false),
  ALLOW_GUEST_CHECKOUT: booleanString.default(true),
  REQUIRE_INTERNAL_MFA: booleanString.default(true),
  INVENTORY_RESERVATION_MINUTES: z.coerce.number().int().min(5).max(120).default(30)
});
