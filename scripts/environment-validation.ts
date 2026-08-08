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

const panelDeploymentModeOptions = ["integrated", "separate"] as const;

const normalize = (value: string | undefined): string => value?.trim().toLowerCase() ?? "";

const enabledBoolean = (value: string | undefined): boolean =>
  ["true", "1", "yes"].includes(normalize(value));

const hasValue = (environment: EnvironmentValues, key: string): boolean =>
  Boolean(environment[key]?.trim());

const addRequiredErrors = (
  environment: EnvironmentValues,
  keys: readonly string[],
  errors: string[]
): void => {
  for (const key of keys) {
    if (!hasValue(environment, key)) {
      errors.push(`${key} não está configurada`);
    }
  }
};

const validateEnum = (
  environment: EnvironmentValues,
  key: keyof typeof providerOptions,
  errors: string[]
): void => {
  const value = normalize(environment[key]);

  if (!value) {
    return;
  }

  const options: readonly string[] = providerOptions[key];

  if (!options.includes(value)) {
    errors.push(`${key} possui valor inválido: ${value}`);
  }
};

const validateBoolean = (environment: EnvironmentValues, key: string, errors: string[]): void => {
  const value = normalize(environment[key]);

  if (!value) {
    return;
  }

  if (!(booleanOptions as readonly string[]).includes(value)) {
    errors.push(`${key} deve ser true ou false`);
  }
};

const validateApplicationEnvironment = (
  deploymentEnvironment: DeploymentEnvironment,
  environment: EnvironmentValues,
  errors: string[]
): void => {
  const value = normalize(environment.APP_ENV);

  if (!value) {
    return;
  }

  if (!(applicationEnvironmentOptions as readonly string[]).includes(value)) {
    errors.push(`APP_ENV possui valor inválido: ${value}`);
    return;
  }

  if (value !== deploymentEnvironment) {
    errors.push(`APP_ENV deve ser ${deploymentEnvironment} neste build`);
  }
};

const validateUrl = (
  environment: EnvironmentValues,
  key: string,
  requireHttps: boolean,
  errors: string[]
): void => {
  const value = environment[key]?.trim();

  if (!value) {
    return;
  }

  try {
    const url = new URL(value);

    if (!["http:", "https:"].includes(url.protocol)) {
      errors.push(`${key} deve usar HTTP ou HTTPS`);
    } else if (requireHttps && url.protocol !== "https:") {
      errors.push(`${key} deve usar HTTPS`);
    } else if (
      key === "NEXT_PUBLIC_SUPABASE_URL" &&
      (url.pathname !== "/" || url.search || url.hash)
    ) {
      errors.push(
        "NEXT_PUBLIC_SUPABASE_URL deve conter somente a origem do projeto, sem /rest/v1 ou outros caminhos"
      );
    }
  } catch {
    errors.push(`${key} deve conter uma URL absoluta válida`);
  }
};

const validateAllowedOrigins = (
  environment: EnvironmentValues,
  requireHttps: boolean,
  errors: string[]
): void => {
  const value = environment.ALLOWED_ORIGINS?.trim();

  if (!value) {
    return;
  }

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
      const normalizedOrigin = origin.replace(/\/$/u, "");

      if (url.origin !== normalizedOrigin) {
        errors.push(`ALLOWED_ORIGINS deve conter apenas origens, sem caminhos: ${origin}`);
      } else if (requireHttps && url.protocol !== "https:") {
        errors.push(`ALLOWED_ORIGINS deve usar HTTPS: ${origin}`);
      }
    } catch {
      errors.push(`ALLOWED_ORIGINS contém uma origem inválida: ${origin}`);
    }
  }
};

const validateSharedCookieDomain = (environment: EnvironmentValues, errors: string[]): void => {
  const rawDomain = normalize(environment.AUTH_COOKIE_DOMAIN).replace(/^\./u, "");

  if (!rawDomain) {
    return;
  }

  if (rawDomain.includes(":") || rawDomain.includes("/") || !rawDomain.includes(".")) {
    errors.push("AUTH_COOKIE_DOMAIN deve conter somente um domínio válido");
    return;
  }

  for (const key of ["NEXT_PUBLIC_STORE_URL", "NEXT_PUBLIC_PANEL_URL"] as const) {
    const rawUrl = environment[key]?.trim();

    if (!rawUrl) {
      continue;
    }

    try {
      const host = new URL(rawUrl).hostname.toLowerCase();

      const belongsToCookieDomain = host === rawDomain || host.endsWith(`.${rawDomain}`);

      if (!belongsToCookieDomain) {
        errors.push(`${key} não pertence a AUTH_COOKIE_DOMAIN`);
      }
    } catch {
      // validateUrl já informa o erro de URL.
    }
  }
};

const validateSeparateApplications = (environment: EnvironmentValues, errors: string[]): void => {
  const deploymentMode = normalize(environment.PANEL_DEPLOYMENT_MODE) || "separate";

  if (!(panelDeploymentModeOptions as readonly string[]).includes(deploymentMode)) {
    errors.push("PANEL_DEPLOYMENT_MODE deve ser integrated ou separate");
    return;
  }

  // No modo integrado, loja e painel podem usar o mesmo Worker.
  if (deploymentMode !== "separate") {
    return;
  }

  const storeValue = environment.NEXT_PUBLIC_STORE_URL?.trim();
  const panelValue = environment.NEXT_PUBLIC_PANEL_URL?.trim();

  if (!storeValue || !panelValue) {
    return;
  }

  try {
    const storeOrigin = new URL(storeValue).origin;
    const panelOrigin = new URL(panelValue).origin;

    if (storeOrigin === panelOrigin) {
      errors.push("NEXT_PUBLIC_STORE_URL e NEXT_PUBLIC_PANEL_URL devem usar aplicações distintas");
    }
  } catch {
    // validateUrl já informa os erros de URL.
  }
};

const validateProviderCredentials = (environment: EnvironmentValues, errors: string[]): void => {
  const paymentProvider = normalize(environment.PAYMENT_PROVIDER);
  const emailProvider = normalize(environment.EMAIL_PROVIDER);
  const shippingProvider = normalize(environment.SHIPPING_PROVIDER);

  const mercadoPagoEnabled =
    ["mercadopago", "mercado_pago"].includes(paymentProvider) ||
    enabledBoolean(environment.MERCADO_PAGO_ENABLED);

  if (mercadoPagoEnabled) {
    addRequiredErrors(
      environment,
      ["MERCADO_PAGO_ACCESS_TOKEN", "MERCADO_PAGO_PUBLIC_KEY", "MERCADO_PAGO_WEBHOOK_SECRET"],
      errors
    );
  }

  const emailEnabled = emailProvider === "resend" || enabledBoolean(environment.EMAIL_ENABLED);

  if (emailEnabled) {
    addRequiredErrors(environment, ["RESEND_API_KEY", "EMAIL_FROM"], errors);
  }

  const melhorEnvioEnabled =
    ["melhorenvio", "melhor_envio"].includes(shippingProvider) ||
    enabledBoolean(environment.MELHOR_ENVIO_ENABLED);

  if (melhorEnvioEnabled) {
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

  if (shippingProvider === "correios") {
    addRequiredErrors(environment, ["CORREIOS_API_TOKEN"], errors);
  }
};

const validateTurnstile = (environment: EnvironmentValues, errors: string[]): void => {
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

const validateCheckoutFlags = (environment: EnvironmentValues, errors: string[]): void => {
  const publicCheckoutValue = environment.NEXT_PUBLIC_CHECKOUT_ENABLED;

  if (publicCheckoutValue !== undefined) {
    validateBoolean(environment, "NEXT_PUBLIC_CHECKOUT_ENABLED", errors);
  }

  if (
    environment.CHECKOUT_ENABLED !== undefined &&
    publicCheckoutValue !== undefined &&
    enabledBoolean(environment.CHECKOUT_ENABLED) !== enabledBoolean(publicCheckoutValue)
  ) {
    errors.push("CHECKOUT_ENABLED e NEXT_PUBLIC_CHECKOUT_ENABLED devem possuir o mesmo valor");
  }
};

const validateCommonValues = (
  environment: EnvironmentValues,
  requireHttps: boolean,
  errors: string[]
): void => {
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

  validateCheckoutFlags(environment, errors);

  validateUrl(environment, "NEXT_PUBLIC_STORE_URL", requireHttps, errors);

  validateUrl(environment, "NEXT_PUBLIC_PANEL_URL", requireHttps, errors);

  validateUrl(environment, "NEXT_PUBLIC_SUPABASE_URL", requireHttps, errors);

  validateAllowedOrigins(environment, requireHttps, errors);

  validateProviderCredentials(environment, errors);
};

const validateProductionRules = (environment: EnvironmentValues, errors: string[]): void => {
  if (enabledBoolean(environment.DEMO_MODE)) {
    errors.push("DEMO_MODE deve ser false em produção");
  }

  const paymentProvider = normalize(environment.PAYMENT_PROVIDER);
  const shippingProvider = normalize(environment.SHIPPING_PROVIDER);
  const emailProvider = normalize(environment.EMAIL_PROVIDER);
  const whatsappProvider = normalize(environment.WHATSAPP_PROVIDER);

  if (paymentProvider === "mock") {
    errors.push("PAYMENT_PROVIDER=mock não é permitido em produção");
  }

  if (shippingProvider === "mock") {
    errors.push("SHIPPING_PROVIDER=mock não é permitido em produção");
  }

  if (emailProvider === "mock") {
    errors.push("EMAIL_PROVIDER=mock não é permitido em produção");
  }

  if (whatsappProvider === "mock") {
    errors.push("WHATSAPP_PROVIDER=mock não é permitido em produção");
  }

  if (
    enabledBoolean(environment.MERCADO_PAGO_ENABLED) &&
    !["mercadopago", "mercado_pago"].includes(paymentProvider)
  ) {
    errors.push("MERCADO_PAGO_ENABLED=true requer PAYMENT_PROVIDER=mercadopago");
  }

  if (
    enabledBoolean(environment.MELHOR_ENVIO_ENABLED) &&
    !["melhorenvio", "melhor_envio"].includes(shippingProvider)
  ) {
    errors.push("MELHOR_ENVIO_ENABLED=true requer SHIPPING_PROVIDER=melhorenvio");
  }

  if (enabledBoolean(environment.EMAIL_ENABLED) && emailProvider !== "resend") {
    errors.push("EMAIL_ENABLED=true requer EMAIL_PROVIDER=resend");
  }

  if (
    enabledBoolean(environment.CHECKOUT_ENABLED) &&
    (paymentProvider === "disabled" || shippingProvider === "disabled")
  ) {
    errors.push("CHECKOUT_ENABLED=true requer providers de pagamento e frete habilitados");
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

    if (enabledBoolean(environment.DEMO_MODE)) {
      addRequiredErrors(environment, ["DEMO_USERS_PASSWORD", "DEMO_SESSION_SECRET"], errors);

      if ((environment.DEMO_SESSION_SECRET?.trim().length ?? 0) < 32) {
        errors.push("DEMO_SESSION_SECRET deve possuir ao menos 32 caracteres");
      }
    }
  }

  if (deploymentEnvironment === "production") {
    addRequiredErrors(environment, productionRequired, errors);

    validateProductionRules(environment, errors);
  }

  validateCommonValues(environment, requiresRemoteHttps, errors);

  validateTurnstile(environment, errors);

  if (requiresRemoteHttps) {
    validateSeparateApplications(environment, errors);
  }

  validateSharedCookieDomain(environment, errors);

  const uniqueErrors = [...new Set(errors)];

  return {
    environment: deploymentEnvironment,
    errors: uniqueErrors,
    valid: uniqueErrors.length === 0
  };
}

export function runEnvironmentValidation(
  deploymentEnvironment: DeploymentEnvironment,
  environment: EnvironmentValues = process.env
): void {
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
