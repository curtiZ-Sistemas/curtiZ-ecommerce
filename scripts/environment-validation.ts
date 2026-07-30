export type DeploymentEnvironment = "development" | "staging" | "production";

export type EnvironmentValues = Readonly<Record<string, string | undefined>>;

export type EnvironmentValidationResult = {
  environment: DeploymentEnvironment;
  errors: string[];
  valid: boolean;
};

const stagingRequired = [
  "NEXT_PUBLIC_STORE_URL",
  "NEXT_PUBLIC_PANEL_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "PII_ENCRYPTION_KEY",
  "AUDIT_HASH_KEY",
  "ALLOWED_ORIGINS"
] as const;

const productionRequired = [
  ...stagingRequired,
  "PAYMENT_PROVIDER",
  "EMAIL_PROVIDER",
  "SHIPPING_PROVIDER",
  "MERCADO_PAGO_ACCESS_TOKEN",
  "MERCADO_PAGO_PUBLIC_KEY",
  "MERCADO_PAGO_WEBHOOK_SECRET",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "DEMO_MODE",
  "REQUIRE_INTERNAL_MFA"
] as const;

const providerOptions = {
  PAYMENT_PROVIDER: ["mock", "mercadopago"],
  EMAIL_PROVIDER: ["mock", "resend"],
  SHIPPING_PROVIDER: ["mock", "melhorenvio", "correios", "custom"]
} as const;

const booleanOptions = ["true", "false"] as const;

const hasValue = (environment: EnvironmentValues, key: string): boolean =>
  Boolean(environment[key]?.trim());

const addRequiredErrors = (
  environment: EnvironmentValues,
  keys: readonly string[],
  errors: string[]
) => {
  for (const key of keys) {
    if (!hasValue(environment, key)) errors.push(`${key} não está configurada`);
  }
};

const validateEnum = (
  environment: EnvironmentValues,
  key: keyof typeof providerOptions,
  errors: string[]
) => {
  const value = environment[key]?.trim();
  if (!value) return;

  const options: readonly string[] = providerOptions[key];
  if (!options.includes(value)) {
    errors.push(`${key} possui valor inválido: ${value}`);
  }
};

const validateBoolean = (environment: EnvironmentValues, key: string, errors: string[]) => {
  const value = environment[key]?.trim();
  if (!value) return;
  if (!(booleanOptions as readonly string[]).includes(value)) {
    errors.push(`${key} deve ser true ou false`);
  }
};

const validateUrl = (
  environment: EnvironmentValues,
  key: string,
  requireHttps: boolean,
  errors: string[]
) => {
  const value = environment[key]?.trim();
  if (!value) return;

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      errors.push(`${key} deve usar HTTP ou HTTPS`);
    } else if (requireHttps && url.protocol !== "https:") {
      errors.push(`${key} deve usar HTTPS`);
    }
  } catch {
    errors.push(`${key} deve conter uma URL absoluta válida`);
  }
};

const validateAllowedOrigins = (
  environment: EnvironmentValues,
  requireHttps: boolean,
  errors: string[]
) => {
  const value = environment.ALLOWED_ORIGINS?.trim();
  if (!value) return;

  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!origins.length) {
    errors.push("ALLOWED_ORIGINS deve conter ao menos uma origem");
    return;
  }

  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (url.origin !== origin.replace(/\/$/u, "")) {
        errors.push(`ALLOWED_ORIGINS deve conter apenas origens, sem caminhos: ${origin}`);
      } else if (requireHttps && url.protocol !== "https:") {
        errors.push(`ALLOWED_ORIGINS deve usar HTTPS: ${origin}`);
      }
    } catch {
      errors.push(`ALLOWED_ORIGINS contém uma origem inválida: ${origin}`);
    }
  }
};

const validateProviderCredentials = (environment: EnvironmentValues, errors: string[]) => {
  if (environment.PAYMENT_PROVIDER === "mercadopago") {
    addRequiredErrors(
      environment,
      ["MERCADO_PAGO_ACCESS_TOKEN", "MERCADO_PAGO_PUBLIC_KEY", "MERCADO_PAGO_WEBHOOK_SECRET"],
      errors
    );
  }

  if (environment.EMAIL_PROVIDER === "resend") {
    addRequiredErrors(environment, ["RESEND_API_KEY", "EMAIL_FROM"], errors);
  }

  if (environment.SHIPPING_PROVIDER === "melhorenvio") {
    addRequiredErrors(environment, ["MELHOR_ENVIO_TOKEN"], errors);
  }

  if (environment.SHIPPING_PROVIDER === "correios") {
    addRequiredErrors(environment, ["CORREIOS_API_TOKEN"], errors);
  }
};

const validateCommonValues = (
  environment: EnvironmentValues,
  requireHttps: boolean,
  errors: string[]
) => {
  validateEnum(environment, "PAYMENT_PROVIDER", errors);
  validateEnum(environment, "EMAIL_PROVIDER", errors);
  validateEnum(environment, "SHIPPING_PROVIDER", errors);
  validateBoolean(environment, "DEMO_MODE", errors);
  validateBoolean(environment, "REQUIRE_INTERNAL_MFA", errors);

  validateUrl(environment, "NEXT_PUBLIC_STORE_URL", requireHttps, errors);
  validateUrl(environment, "NEXT_PUBLIC_PANEL_URL", requireHttps, errors);
  validateUrl(environment, "NEXT_PUBLIC_SUPABASE_URL", requireHttps, errors);
  validateAllowedOrigins(environment, requireHttps, errors);
  validateProviderCredentials(environment, errors);
};

const validateTurnstilePair = (environment: EnvironmentValues, errors: string[]) => {
  const hasSiteKey = hasValue(environment, "NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  const hasSecret = hasValue(environment, "TURNSTILE_SECRET_KEY");
  if (hasSiteKey !== hasSecret) {
    errors.push(
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY e TURNSTILE_SECRET_KEY devem ser configuradas em conjunto"
    );
  }
};

export function validateEnvironment(
  deploymentEnvironment: DeploymentEnvironment,
  environment: EnvironmentValues
): EnvironmentValidationResult {
  const errors: string[] = [];
  const requiresRemoteHttps = deploymentEnvironment !== "development";

  if (deploymentEnvironment === "staging") {
    addRequiredErrors(environment, stagingRequired, errors);
    validateTurnstilePair(environment, errors);
  }

  if (deploymentEnvironment === "production") {
    addRequiredErrors(environment, productionRequired, errors);

    if (environment.DEMO_MODE !== "false") {
      errors.push("DEMO_MODE deve ser false em produção");
    }
    if (environment.PAYMENT_PROVIDER !== "mercadopago") {
      errors.push("PAYMENT_PROVIDER deve ser mercadopago em produção");
    }
    if (environment.EMAIL_PROVIDER !== "resend") {
      errors.push("EMAIL_PROVIDER deve usar um provedor real em produção");
    }
    if (!environment.SHIPPING_PROVIDER || environment.SHIPPING_PROVIDER === "mock") {
      errors.push("SHIPPING_PROVIDER deve usar um provedor real em produção");
    }
    if (environment.REQUIRE_INTERNAL_MFA !== "true") {
      errors.push("REQUIRE_INTERNAL_MFA deve ser true em produção");
    }
  }

  validateCommonValues(environment, requiresRemoteHttps, errors);

  return {
    environment: deploymentEnvironment,
    errors: [...new Set(errors)],
    valid: errors.length === 0
  };
}

export function runEnvironmentValidation(
  deploymentEnvironment: DeploymentEnvironment,
  environment: EnvironmentValues = process.env
) {
  const result = validateEnvironment(deploymentEnvironment, environment);

  if (!result.valid) {
    console.error(
      `Configuração de ${deploymentEnvironment} inválida:\n- ${result.errors.join("\n- ")}`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Configuração de ${deploymentEnvironment} validada com sucesso.`);
}
