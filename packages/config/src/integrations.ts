export type OptionalPaymentProvider = "disabled" | "mock" | "mercadopago";
export type OptionalEmailProvider = "disabled" | "mock" | "resend";
export type OptionalShippingProvider = "disabled" | "fixed" | "mock" | "melhorenvio" | "correios" | "custom";
export type OptionalWhatsAppProvider = "disabled" | "mock" | "meta";

const truthy = new Set(["true", "1", "yes"]);
const falsy = new Set(["false", "0", "no", ""]);

export const parseEnvironmentBoolean = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (truthy.has(normalized)) return true;
  if (falsy.has(normalized)) return false;
  return fallback;
};

export type IntegrationEnvironment = Readonly<Record<string, string | undefined>>;

const isValidHttpsUrl = (value: string | undefined): boolean => {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};

export const isMelhorEnvioSandboxReady = (environment: IntegrationEnvironment): boolean => {
  const baseUrl = environment.MELHOR_ENVIO_BASE_URL?.trim();
  const tokenExpiresAt = Date.parse(environment.MELHOR_ENVIO_ACCESS_TOKEN_EXPIRES_AT?.trim() ?? "");
  if (!baseUrl || !isValidHttpsUrl(baseUrl)) return false;
  const parsedBaseUrl = new URL(baseUrl);
  return parseEnvironmentBoolean(environment.MELHOR_ENVIO_ENABLED)
    && parseEnvironmentBoolean(environment.MELHOR_ENVIO_OAUTH_VALIDATED)
    && parsedBaseUrl.origin === "https://sandbox.melhorenvio.com.br"
    && parsedBaseUrl.pathname === "/"
    && !parsedBaseUrl.search
    && !parsedBaseUrl.hash
    && isValidHttpsUrl(environment.MELHOR_ENVIO_REDIRECT_URI)
    && Boolean(environment.MELHOR_ENVIO_CLIENT_ID?.trim())
    && Boolean(environment.MELHOR_ENVIO_CLIENT_SECRET?.trim())
    && Boolean(environment.MELHOR_ENVIO_ACCESS_TOKEN?.trim())
    && Number.isFinite(tokenExpiresAt)
    && tokenExpiresAt > Date.now();
};

export const getIntegrationConfig = (environment: IntegrationEnvironment = process.env) => {
  const rawPaymentProvider = environment.PAYMENT_PROVIDER?.trim().toLowerCase();
  const rawShippingProvider = environment.SHIPPING_PROVIDER?.trim().toLowerCase();
  const paymentProvider = (
    rawPaymentProvider === "mercado_pago" ? "mercadopago" : rawPaymentProvider || "disabled"
  ) as OptionalPaymentProvider;
  const requestedShippingProvider = (
    rawShippingProvider === "melhor_envio" ? "melhorenvio" : rawShippingProvider || "disabled"
  ) as OptionalShippingProvider;
  const emailProvider = (environment.EMAIL_PROVIDER?.trim().toLowerCase() ||
    "disabled") as OptionalEmailProvider;
  const whatsappProvider = (environment.WHATSAPP_PROVIDER?.trim().toLowerCase() ||
    "disabled") as OptionalWhatsAppProvider;
  const mercadoPagoEnabled =
    parseEnvironmentBoolean(environment.MERCADO_PAGO_ENABLED) || paymentProvider === "mercadopago";
  const melhorEnvioEnabled = isMelhorEnvioSandboxReady(environment);
  const shippingProvider = requestedShippingProvider === "melhorenvio"
    ? melhorEnvioEnabled ? "melhorenvio" : "fixed"
    : requestedShippingProvider;
  const emailEnabled =
    parseEnvironmentBoolean(environment.EMAIL_ENABLED) || emailProvider === "resend";
  const turnstileEnabled = parseEnvironmentBoolean(environment.TURNSTILE_ENABLED);
  const googleMerchantEnabled = parseEnvironmentBoolean(environment.GOOGLE_MERCHANT_ENABLED);
  const paymentEnabled =
    paymentProvider === "mock" || (paymentProvider === "mercadopago" && mercadoPagoEnabled);
  const shippingEnabled =
    shippingProvider === "fixed" ||
    shippingProvider === "mock" ||
    shippingProvider === "correios" ||
    shippingProvider === "custom" ||
    (shippingProvider === "melhorenvio" && melhorEnvioEnabled);
  const checkoutEnabled =
    parseEnvironmentBoolean(environment.CHECKOUT_ENABLED) && paymentEnabled && shippingEnabled;

  return {
    checkoutEnabled,
    payment: { provider: paymentProvider, enabled: paymentEnabled, mercadoPagoEnabled },
    shipping: { provider: shippingProvider, enabled: shippingEnabled, melhorEnvioEnabled },
    email: { provider: emailProvider, enabled: emailEnabled },
    whatsapp: { provider: whatsappProvider, enabled: whatsappProvider !== "disabled" },
    googleMerchant: { enabled: googleMerchantEnabled },
    turnstile: { enabled: turnstileEnabled },
    internalMfaRequired: parseEnvironmentBoolean(environment.REQUIRE_INTERNAL_MFA)
  } as const;
};

export const getPublicIntegrationStatus = (environment: IntegrationEnvironment = process.env) => {
  const config = getIntegrationConfig(environment);
  return {
    checkoutEnabled: config.checkoutEnabled,
    paymentEnabled: config.payment.enabled,
    shippingEnabled: config.shipping.enabled,
    emailEnabled: config.email.enabled,
    turnstileEnabled: config.turnstile.enabled
  } as const;
};

export const isCheckoutEnabled = (environment?: IntegrationEnvironment) =>
  getIntegrationConfig(environment).checkoutEnabled;
export const isMercadoPagoEnabled = (environment?: IntegrationEnvironment) =>
  getIntegrationConfig(environment).payment.mercadoPagoEnabled;
export const isMelhorEnvioEnabled = (environment?: IntegrationEnvironment) =>
  getIntegrationConfig(environment).shipping.melhorEnvioEnabled;
export const isEmailEnabled = (environment?: IntegrationEnvironment) =>
  getIntegrationConfig(environment).email.enabled;
export const isTurnstileEnabled = (environment?: IntegrationEnvironment) =>
  getIntegrationConfig(environment).turnstile.enabled;
export const isGoogleMerchantEnabled = (environment?: IntegrationEnvironment) =>
  getIntegrationConfig(environment).googleMerchant.enabled;
export const isInternalMfaRequired = (environment?: IntegrationEnvironment) =>
  getIntegrationConfig(environment).internalMfaRequired;
