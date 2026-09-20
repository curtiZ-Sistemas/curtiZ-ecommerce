import { publicEnvironmentErrors } from "./public-environment";

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
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "ACCOUNT_DELETION_HMAC_KEY",
  "PII_ENCRYPTION_KEY",
  "AUDIT_HASH_KEY",
  "RATE_LIMIT_HMAC_KEY",
  "REFERRAL_ATTRIBUTION_HMAC_KEY",
  "ALLOWED_ORIGINS",
  "AUTH_COOKIE_DOMAINS"
] as const;

const productionRequired = [
  ...stagingRequired,
  "NEXT_PUBLIC_STORE_TEST_URL",
  "NEXT_PUBLIC_PANEL_TEST_URL",
  "DEMO_MODE",
  "CHECKOUT_ENABLED",
  "PAYMENT_PROVIDER",
  "MERCADO_PAGO_ENABLED",
  "EMAIL_PROVIDER",
  "EMAIL_ENABLED",
  "SHIPPING_PROVIDER",
  "MELHOR_ENVIO_ENABLED",
  "TURNSTILE_ENABLED",
  "REQUIRE_INTERNAL_MFA",
  "AUTH_RATE_LIMIT_ENABLED"
] as const;

const providerOptions = {
  PAYMENT_PROVIDER: ["disabled", "mock", "mercadopago", "mercado_pago"],
  EMAIL_PROVIDER: ["disabled", "mock", "resend"],
  SHIPPING_PROVIDER: ["disabled", "fixed", "mock", "melhorenvio", "melhor_envio", "correios", "custom"],
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
      key === "SUPABASE_URL" &&
      (url.pathname !== "/" || url.search || url.hash || url.username || url.password)
    ) {
      errors.push(
        "SUPABASE_URL deve conter somente a origem do projeto, sem /rest/v1 ou outros caminhos"
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

  const originSet = new Set(origins.map((item) => item.replace(/\/$/u, "")));
  for (const key of [
    "NEXT_PUBLIC_STORE_URL",
    "NEXT_PUBLIC_PANEL_URL",
    "NEXT_PUBLIC_STORE_TEST_URL",
    "NEXT_PUBLIC_PANEL_TEST_URL"
  ] as const) {
    const configuredUrl = environment[key]?.trim();
    if (!configuredUrl) continue;
    try {
      const configuredOrigin = new URL(configuredUrl).origin;
      if (!originSet.has(configuredOrigin)) {
        errors.push(`ALLOWED_ORIGINS deve incluir ${key}`);
      }
    } catch {
      // validateUrl já informa o erro de URL.
    }
  }
};

const validateSharedCookieDomain = (environment: EnvironmentValues, errors: string[]): void => {
  const configuredDomains =
    environment.AUTH_COOKIE_DOMAINS?.trim() || environment.AUTH_COOKIE_DOMAIN?.trim() || "";
  const domains = configuredDomains
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^\./u, ""))
    .filter(Boolean);

  if (!domains.length) {
    return;
  }

  for (const domain of domains) {
    if (domain.includes(":") || domain.includes("/") || !domain.includes(".")) {
      errors.push("AUTH_COOKIE_DOMAINS deve conter somente domínios válidos separados por vírgula");
      return;
    }
  }

  for (const key of [
    "NEXT_PUBLIC_STORE_URL",
    "NEXT_PUBLIC_PANEL_URL",
    "NEXT_PUBLIC_STORE_TEST_URL",
    "NEXT_PUBLIC_PANEL_TEST_URL"
  ] as const) {
    const rawUrl = environment[key]?.trim();

    if (!rawUrl) {
      continue;
    }

    try {
      const host = new URL(rawUrl).hostname.toLowerCase();

      const belongsToCookieDomain = domains.some(
        (domain) => host === domain || host.endsWith(`.${domain}`)
      );

      if (!belongsToCookieDomain) {
        errors.push(`${key} não pertence a nenhum domínio de AUTH_COOKIE_DOMAINS`);
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

const validateTestUrlPair = (environment: EnvironmentValues, errors: string[]): void => {
  const storeTestUrl = environment.NEXT_PUBLIC_STORE_TEST_URL?.trim();
  const panelTestUrl = environment.NEXT_PUBLIC_PANEL_TEST_URL?.trim();

  if (Boolean(storeTestUrl) !== Boolean(panelTestUrl)) {
    errors.push(
      "NEXT_PUBLIC_STORE_TEST_URL e NEXT_PUBLIC_PANEL_TEST_URL devem ser configuradas em conjunto"
    );
    return;
  }

  if (!storeTestUrl || !panelTestUrl) return;
  try {
    if (new URL(storeTestUrl).origin === new URL(panelTestUrl).origin) {
      errors.push("As URLs de teste da loja e do painel devem usar aplicações distintas");
    }
  } catch {
    // validateUrl já informa os erros de URL.
  }
};

export function requiredDeploymentSecrets(environment: EnvironmentValues): string[] {
  const required = new Set(["SUPABASE_SECRET_KEY", "PII_ENCRYPTION_KEY", "AUDIT_HASH_KEY"]);
  if (normalize(environment.DEPLOY_TARGET) !== "panel") {
    required.add("ACCOUNT_DELETION_HMAC_KEY");
    required.add("RATE_LIMIT_HMAC_KEY");
    required.add("REFERRAL_ATTRIBUTION_HMAC_KEY");
  }
  if (["mercadopago", "mercado_pago"].includes(normalize(environment.PAYMENT_PROVIDER))
    || enabledBoolean(environment.MERCADO_PAGO_ENABLED)) {
    required.add("MERCADO_PAGO_ACCESS_TOKEN");
    required.add("MERCADO_PAGO_WEBHOOK_SECRET");
  }
  if (normalize(environment.EMAIL_PROVIDER) === "resend" || enabledBoolean(environment.EMAIL_ENABLED)) {
    required.add("RESEND_API_KEY");
  }
  if (normalize(environment.SHIPPING_PROVIDER) === "correios") required.add("CORREIOS_API_TOKEN");
  if (["melhorenvio", "melhor_envio"].includes(normalize(environment.SHIPPING_PROVIDER))
    || enabledBoolean(environment.MELHOR_ENVIO_ENABLED)) {
    required.add("MELHOR_ENVIO_CLIENT_SECRET");
    required.add("MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY");
  }
  if (enabledBoolean(environment.TURNSTILE_ENABLED) || hasValue(environment, "NEXT_PUBLIC_TURNSTILE_SITE_KEY")) {
    required.add("TURNSTILE_SECRET_KEY");
  }
  return [...required].sort();
}

const validateProviderCredentials = (environment: EnvironmentValues, errors: string[]): void => {
  const paymentProvider = normalize(environment.PAYMENT_PROVIDER);
  const emailProvider = normalize(environment.EMAIL_PROVIDER);
  const shippingProvider = normalize(environment.SHIPPING_PROVIDER);

  const mercadoPagoEnabled =
    ["mercadopago", "mercado_pago"].includes(paymentProvider) ||
    enabledBoolean(environment.MERCADO_PAGO_ENABLED);

  addRequiredErrors(environment, requiredDeploymentSecrets(environment).filter((name) =>
    !["SUPABASE_SECRET_KEY", "ACCOUNT_DELETION_HMAC_KEY", "PII_ENCRYPTION_KEY", "AUDIT_HASH_KEY",
      "RATE_LIMIT_HMAC_KEY", "REFERRAL_ATTRIBUTION_HMAC_KEY", "TURNSTILE_SECRET_KEY"].includes(name)
  ), errors);

  if (mercadoPagoEnabled) {
    addRequiredErrors(
      environment,
      [
        "NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY",
        "MERCADO_PAGO_ENVIRONMENT"
      ],
      errors
    );
    if (hasValue(environment, "MERCADO_PAGO_ENVIRONMENT")
      && normalize(environment.MERCADO_PAGO_ENVIRONMENT) !== "test") {
      errors.push("MERCADO_PAGO_ENVIRONMENT deve ser test enquanto o adapter live não estiver habilitado");
    }
    if (
      hasValue(environment, "MERCADO_PAGO_ACCESS_TOKEN") &&
      !environment.MERCADO_PAGO_ACCESS_TOKEN?.trim().startsWith("TEST-")
    ) {
      errors.push("MERCADO_PAGO_ACCESS_TOKEN deve ser uma credencial de teste");
    }
    if (
      hasValue(environment, "NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY") &&
      !environment.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY?.trim().startsWith("TEST-")
    ) {
      errors.push("NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY deve ser uma credencial de teste");
    }
  }

  if (["melhorenvio", "melhor_envio"].includes(shippingProvider)) {
    addRequiredErrors(environment, ["MELHOR_ENVIO_ENVIRONMENT", "MELHOR_ENVIO_REDIRECT_URI",
      "MELHOR_ENVIO_CLIENT_ID", "MELHOR_ENVIO_CLIENT_SECRET", "MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY",
      "MELHOR_ENVIO_APP_NAME", "MELHOR_ENVIO_TECHNICAL_CONTACT", "MELHOR_ENVIO_WEBHOOK_CONFIGURED",
      "MELHOR_ENVIO_ORIGIN_NAME", "MELHOR_ENVIO_ORIGIN_EMAIL", "MELHOR_ENVIO_ORIGIN_PHONE",
      "MELHOR_ENVIO_ORIGIN_ADDRESS", "MELHOR_ENVIO_ORIGIN_NUMBER", "MELHOR_ENVIO_ORIGIN_DISTRICT",
      "MELHOR_ENVIO_ORIGIN_CITY", "MELHOR_ENVIO_ORIGIN_STATE", "MELHOR_ENVIO_ORIGIN_POSTAL_CODE"], errors);
    if (!hasValue(environment, "MELHOR_ENVIO_ORIGIN_DOCUMENT")
      && !hasValue(environment, "MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT")) {
      errors.push("MELHOR_ENVIO_ORIGIN_DOCUMENT ou MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT deve ser configurada");
    }
    if (hasValue(environment, "MELHOR_ENVIO_ENVIRONMENT")
      && !["sandbox", "production"].includes(normalize(environment.MELHOR_ENVIO_ENVIRONMENT))) {
      errors.push("MELHOR_ENVIO_ENVIRONMENT deve ser sandbox ou production");
    }
    if (hasValue(environment, "MELHOR_ENVIO_ORIGIN_POSTAL_CODE")
      && !/^\d{8}$/u.test(environment.MELHOR_ENVIO_ORIGIN_POSTAL_CODE?.replace(/\D/gu, "") ?? "")) {
      errors.push("MELHOR_ENVIO_ORIGIN_POSTAL_CODE deve conter 8 dígitos");
    }
    if (hasValue(environment, "MELHOR_ENVIO_ORIGIN_PHONE")
      && !/^\d{10,11}$/u.test(environment.MELHOR_ENVIO_ORIGIN_PHONE?.replace(/\D/gu, "") ?? "")) {
      errors.push("MELHOR_ENVIO_ORIGIN_PHONE deve conter 10 ou 11 dígitos");
    }
    if (hasValue(environment, "MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY")
      && !/^[A-Za-z0-9+/]{43}=$/u.test(environment.MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY?.trim() ?? "")) {
      errors.push("MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY deve codificar exatamente 32 bytes em base64");
    }
    if (hasValue(environment, "MELHOR_ENVIO_ORIGIN_STATE")
      && !/^[A-Za-z]{2}$/u.test(environment.MELHOR_ENVIO_ORIGIN_STATE?.trim() ?? "")) {
      errors.push("MELHOR_ENVIO_ORIGIN_STATE deve conter a sigla com 2 letras");
    }
    if (hasValue(environment, "MELHOR_ENVIO_ORIGIN_DOCUMENT")
      && !/^\d{11}$/u.test(environment.MELHOR_ENVIO_ORIGIN_DOCUMENT?.replace(/\D/gu, "") ?? "")) {
      errors.push("MELHOR_ENVIO_ORIGIN_DOCUMENT deve conter 11 dígitos");
    }
    if (hasValue(environment, "MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT")
      && !/^\d{14}$/u.test(environment.MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT?.replace(/\D/gu, "") ?? "")) {
      errors.push("MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT deve conter 14 dígitos");
    }
    if (normalize(environment.MELHOR_ENVIO_ENVIRONMENT) === "production") {
      addRequiredErrors(environment, ["MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT", "MELHOR_ENVIO_ORIGIN_STATE_REGISTER"], errors);
    }
  }

  const emailEnabled = emailProvider === "resend" || enabledBoolean(environment.EMAIL_ENABLED);

  if (emailEnabled) {
    addRequiredErrors(environment, ["EMAIL_FROM"], errors);
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
  errors.push(...publicEnvironmentErrors(environment));
  validateEnum(environment, "PAYMENT_PROVIDER", errors);
  validateEnum(environment, "EMAIL_PROVIDER", errors);
  validateEnum(environment, "SHIPPING_PROVIDER", errors);
  validateEnum(environment, "WHATSAPP_PROVIDER", errors);

  validateBoolean(environment, "DEMO_MODE", errors);
  validateBoolean(environment, "REQUIRE_INTERNAL_MFA", errors);
  validateBoolean(environment, "AUTH_RATE_LIMIT_ENABLED", errors);
  validateBoolean(environment, "CHECKOUT_ENABLED", errors);
  validateBoolean(environment, "MERCADO_PAGO_ENABLED", errors);
  validateBoolean(environment, "MELHOR_ENVIO_ENABLED", errors);
  validateBoolean(environment, "MELHOR_ENVIO_WEBHOOK_CONFIGURED", errors);
  validateBoolean(environment, "EMAIL_ENABLED", errors);
  validateBoolean(environment, "TURNSTILE_ENABLED", errors);

  validateCheckoutFlags(environment, errors);

  validateUrl(environment, "NEXT_PUBLIC_STORE_URL", requireHttps, errors);

  validateUrl(environment, "NEXT_PUBLIC_PANEL_URL", requireHttps, errors);

  validateUrl(environment, "NEXT_PUBLIC_STORE_TEST_URL", requireHttps, errors);

  validateUrl(environment, "NEXT_PUBLIC_PANEL_TEST_URL", requireHttps, errors);

  validateUrl(environment, "SUPABASE_URL", requireHttps, errors);

  validateUrl(environment, "MELHOR_ENVIO_BASE_URL", requireHttps, errors);

  validateUrl(environment, "MELHOR_ENVIO_REDIRECT_URI", requireHttps, errors);

  validateAllowedOrigins(environment, requireHttps, errors);

  validateTestUrlPair(environment, errors);

  validateProviderCredentials(environment, errors);
  if (requireHttps) {
    for (const name of ["ACCOUNT_DELETION_HMAC_KEY", "RATE_LIMIT_HMAC_KEY", "REFERRAL_ATTRIBUTION_HMAC_KEY"] as const) {
      if (hasValue(environment, name) && (environment[name]?.trim().length ?? 0) < 32) {
        errors.push(`${name} deve possuir ao menos 32 caracteres`);
      }
    }
  }
};

const validateProductionRules = (environment: EnvironmentValues, errors: string[]): void => {
  if (enabledBoolean(environment.DEMO_MODE)) {
    errors.push("DEMO_MODE deve ser false em produção");
  }

  if (!enabledBoolean(environment.AUTH_RATE_LIMIT_ENABLED)) {
    errors.push("AUTH_RATE_LIMIT_ENABLED deve ser true em produção");
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

  if (enabledBoolean(environment.EMAIL_ENABLED) && emailProvider !== "resend") {
    errors.push("EMAIL_ENABLED=true requer EMAIL_PROVIDER=resend");
  }

  if (["melhorenvio", "melhor_envio"].includes(shippingProvider)) {
    if (!enabledBoolean(environment.MELHOR_ENVIO_ENABLED)) {
      errors.push("SHIPPING_PROVIDER=melhorenvio requer MELHOR_ENVIO_ENABLED=true");
    }
    if (!enabledBoolean(environment.MELHOR_ENVIO_WEBHOOK_CONFIGURED)) {
      errors.push("Melhor Envio em produção requer MELHOR_ENVIO_WEBHOOK_CONFIGURED=true");
    }
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
