export type DeploymentEnvironment = "development" | "staging" | "production";

export type EnvironmentValues = Readonly<Record<string, string | undefined>>;

export type EnvironmentValidationResult = {
  environment: DeploymentEnvironment;
  errors: string[];
  valid: boolean;
};

const stagingRequired = [
  "APP_ENV",
  "NEXT_PUBLIC_STORE_URL",
  "NEXT_PUBLIC_PANEL_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "PII_ENCRYPTION_KEY",
  "AUDIT_HASH_KEY",
  "ALLOWED_ORIGINS",
  "AUTH_COOKIE_DOMAIN"
] as const;

const productionRequired = [
  ...stagingRequired,
  "PAYMENT_PROVIDER",
  "EMAIL_PROVIDER",
  "SHIPPING_PROVIDER",
  "REQUIRE_INTERNAL_MFA"
] as const;

const providerOptions = {
  PAYMENT_PROVIDER: ["disabled", "mock", "mercadopago", "mercado_pago"],
  EMAIL_PROVIDER: ["disabled", "mock", "resend"],
  SHIPPING_PROVIDER: ["disabled", "mock", "melhorenvio", "melhor_envio", "correios", "custom"],
  WHATSAPP_PROVIDER: ["disabled", "mock", "meta"]
} as const;

const booleanOptions = ["true", "false", "1", "0", "yes", "no"] as const;
const applicationEnvironmentOptions = ["development", "staging", "production"] as const;

const enabledBoolean = (value: string | undefined): boolean =>
  ["true", "1", "yes"].includes(value?.trim().toLowerCase() ?? "");

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
  const value = environment[key]?.trim().toLowerCase();
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

const validateApplicationEnvironment = (
  deploymentEnvironment: DeploymentEnvironment,
  environment: EnvironmentValues,
  errors: string[]
) => {
  const value = environment.APP_ENV?.trim().toLowerCase();
  if (!value) return;
  if (!(applicationEnvironmentOptions as readonly string[]).includes(value)) {
    errors.push(`APP_ENV possui valor inválido: ${value}`);
  } else if (value !== deploymentEnvironment) {
    errors.push(`APP_ENV deve ser ${deploymentEnvironment} neste build`);
  }
};

const validateSharedCookieDomain = (environment: EnvironmentValues, errors: string[]) => {
  const rawDomain = environment.AUTH_COOKIE_DOMAIN?.trim().toLowerCase().replace(/^\./u, "");
  if (!rawDomain) return;
  if (rawDomain.includes(":") || rawDomain.includes("/") || !rawDomain.includes(".")) {
    errors.push("AUTH_COOKIE_DOMAIN deve conter somente um domínio válido");
    return;
  }

  for (const key of ["NEXT_PUBLIC_STORE_URL", "NEXT_PUBLIC_PANEL_URL"] as const) {
    const rawUrl = environment[key]?.trim();
    if (!rawUrl) continue;
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      if (host !== rawDomain && !host.endsWith(`.${rawDomain}`)) {
        errors.push(`${key} não pertence a AUTH_COOKIE_DOMAIN`);
      }
    } catch {
      // validateUrl informa o erro de URL.
    }
  }
};

const validateSeparateApplications = (environment: EnvironmentValues, errors: string[]) => {
  const storeUrl = environment.NEXT_PUBLIC_STORE_URL?.trim().replace(/\/$/u, "");
  const panelUrl = environment.NEXT_PUBLIC_PANEL_URL?.trim().replace(/\/$/u, "");
  if (storeUrl && panelUrl && storeUrl === panelUrl) {
    errors.push("NEXT_PUBLIC_STORE_URL e NEXT_PUBLIC_PANEL_URL devem usar aplicações distintas");
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
  if (
    ["mercadopago", "mercado_pago"].includes(
      environment.PAYMENT_PROVIDER?.trim().toLowerCase() ?? ""
    ) ||
    enabledBoolean(environment.MERCADO_PAGO_ENABLED)
  ) {
    addRequiredErrors(
      environment,
      ["MERCADO_PAGO_ACCESS_TOKEN", "MERCADO_PAGO_PUBLIC_KEY", "MERCADO_PAGO_WEBHOOK_SECRET"],
      errors
    );
  }

  if (
    environment.EMAIL_PROVIDER?.trim().toLowerCase() === "resend" ||
    enabledBoolean(environment.EMAIL_ENABLED)
  ) {
    addRequiredErrors(environment, ["RESEND_API_KEY", "EMAIL_FROM"], errors);
  }

  if (
    ["melhorenvio", "melhor_envio"].includes(
      environment.SHIPPING_PROVIDER?.trim().toLowerCase() ?? ""
    ) ||
    enabledBoolean(environment.MELHOR_ENVIO_ENABLED)
  ) {
    addRequiredErrors(
      environment,
      [
        "MELHOR_ENVIO_CLIENT_ID",
        "MELHOR_ENVIO_CLIENT_SECRET",
        "MELHOR_ENVIO_ACCESS_TOKEN",
        "MELHOR_ENVIO_REFRESH_TOKEN",
        "MELHOR_ENVIO_WEBHOOK_SECRET"
      ],
      errors
    );
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
  validateEnum(environment, "WHATSAPP_PROVIDER", errors);
  validateBoolean(environment, "DEMO_MODE", errors);
  validateBoolean(environment, "REQUIRE_INTERNAL_MFA", errors);
  validateBoolean(environment, "CHECKOUT_ENABLED", errors);
  validateBoolean(environment, "MERCADO_PAGO_ENABLED", errors);
  validateBoolean(environment, "MELHOR_ENVIO_ENABLED", errors);
  validateBoolean(environment, "EMAIL_ENABLED", errors);
  validateBoolean(environment, "TURNSTILE_ENABLED", errors);

  validateUrl(environment, "NEXT_PUBLIC_STORE_URL", requireHttps, errors);
  validateUrl(environment, "NEXT_PUBLIC_PANEL_URL", requireHttps, errors);
  validateUrl(environment, "NEXT_PUBLIC_SUPABASE_URL", requireHttps, errors);
  validateAllowedOrigins(environment, requireHttps, errors);
  validateProviderCredentials(environment, errors);
};

const validateTurnstile = (environment: EnvironmentValues, errors: string[]) => {
  if (enabledBoolean(environment.TURNSTILE_ENABLED)) {
    addRequiredErrors(
      environment,
      ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"],
      errors
    );
    return;
  }
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
  validateApplicationEnvironment(deploymentEnvironment, environment, errors);

  if (deploymentEnvironment === "staging") {
    addRequiredErrors(environment, stagingRequired, errors);
    validateTurnstile(environment, errors);
    if (enabledBoolean(environment.DEMO_MODE)) {
      addRequiredErrors(environment, ["DEMO_USERS_PASSWORD", "DEMO_SESSION_SECRET"], errors);
      if ((environment.DEMO_SESSION_SECRET?.trim().length ?? 0) < 32) {
        errors.push("DEMO_SESSION_SECRET deve possuir ao menos 32 caracteres");
      }
    }
  }

  if (deploymentEnvironment === "production") {
    addRequiredErrors(environment, productionRequired, errors);

    if (enabledBoolean(environment.DEMO_MODE)) {
      errors.push("DEMO_MODE deve ser false em produção");
    }
    const paymentProvider = environment.PAYMENT_PROVIDER?.trim().toLowerCase();
    const shippingProvider = environment.SHIPPING_PROVIDER?.trim().toLowerCase();
    const emailProvider = environment.EMAIL_PROVIDER?.trim().toLowerCase();
    const whatsappProvider = environment.WHATSAPP_PROVIDER?.trim().toLowerCase();
    if (paymentProvider === "mock")
      errors.push("PAYMENT_PROVIDER=mock não é permitido em produção");
    if (shippingProvider === "mock")
      errors.push("SHIPPING_PROVIDER=mock não é permitido em produção");
    if (emailProvider === "mock") errors.push("EMAIL_PROVIDER=mock não é permitido em produção");
    if (whatsappProvider === "mock") {
      errors.push("WHATSAPP_PROVIDER=mock não é permitido em produção");
    }
    if (enabledBoolean(environment.MERCADO_PAGO_ENABLED) && paymentProvider === "disabled") {
      errors.push("MERCADO_PAGO_ENABLED=true requer PAYMENT_PROVIDER=mercadopago");
    }
    if (enabledBoolean(environment.MELHOR_ENVIO_ENABLED) && shippingProvider === "disabled") {
      errors.push("MELHOR_ENVIO_ENABLED=true requer SHIPPING_PROVIDER=melhor_envio");
    }
    if (enabledBoolean(environment.EMAIL_ENABLED) && emailProvider === "disabled") {
      errors.push("EMAIL_ENABLED=true requer EMAIL_PROVIDER=resend");
    }
    if (
      enabledBoolean(environment.CHECKOUT_ENABLED) &&
      (paymentProvider === "disabled" || shippingProvider === "disabled")
    ) {
      errors.push("CHECKOUT_ENABLED=true requer providers de pagamento e frete habilitados");
    }
  }

  validateCommonValues(environment, requiresRemoteHttps, errors);
  validateTurnstile(environment, errors);
  if (requiresRemoteHttps) validateSeparateApplications(environment, errors);
  validateSharedCookieDomain(environment, errors);

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
