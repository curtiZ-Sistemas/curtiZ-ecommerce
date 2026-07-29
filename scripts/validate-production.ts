const requiredProduction = [
  "NEXT_PUBLIC_STORE_URL",
  "NEXT_PUBLIC_PANEL_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "MERCADO_PAGO_ACCESS_TOKEN",
  "MERCADO_PAGO_PUBLIC_KEY",
  "MERCADO_PAGO_WEBHOOK_SECRET",
  "TURNSTILE_SECRET_KEY",
  "PII_ENCRYPTION_KEY",
  "AUDIT_HASH_KEY",
  "ALLOWED_ORIGINS"
] as const;

const errors: string[] = [];

for (const key of requiredProduction) {
  if (!process.env[key]) errors.push(`${key} não está configurada`);
}

if (process.env.DEMO_MODE === "true") errors.push("DEMO_MODE não pode estar ativo");
if (process.env.PAYMENT_PROVIDER !== "mercado_pago") {
  errors.push("PAYMENT_PROVIDER deve usar Mercado Pago em produção");
}
if (process.env.REQUIRE_INTERNAL_MFA !== "true") errors.push("MFA interno deve ser obrigatório");
if (process.env.NEXT_PUBLIC_STORE_URL?.startsWith("http://")) errors.push("A loja deve usar HTTPS");
if (process.env.NEXT_PUBLIC_PANEL_URL?.startsWith("http://")) errors.push("O painel deve usar HTTPS");
if (process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http://")) {
  errors.push("O Supabase deve usar HTTPS");
}
if (process.env.ALLOWED_ORIGINS?.split(",").some((origin) => origin.trim().startsWith("http://"))) {
  errors.push("Todas as origens permitidas devem usar HTTPS");
}

if (errors.length) {
  console.error(`Configuração de produção inválida:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
