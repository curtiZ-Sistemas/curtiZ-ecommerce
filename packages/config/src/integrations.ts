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

const isAes256Base64Key = (value: string | undefined): boolean => {
  const encoded = value?.trim() ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(encoded)) return false;
  try { return atob(encoded).length === 32; }
  catch { return false; }
};

export const getMelhorEnvioEnvironment = (environment: IntegrationEnvironment): "sandbox" | "production" | null => {
  const selected = environment.MELHOR_ENVIO_ENVIRONMENT?.trim().toLowerCase() || "sandbox";
  return selected === "sandbox" || selected === "production" ? selected : null;
};

export const isMelhorEnvioConfigured = (environment: IntegrationEnvironment): boolean => {
  const selected = getMelhorEnvioEnvironment(environment);
  if (!selected) return false;
  const expectedOrigin = selected === "sandbox"
    ? "https://sandbox.melhorenvio.com.br" : "https://melhorenvio.com.br";
  const legacyBaseUrl = environment.MELHOR_ENVIO_BASE_URL?.trim();
  if (legacyBaseUrl) {
    if (!isValidHttpsUrl(legacyBaseUrl)) return false;
    const parsed = new URL(legacyBaseUrl);
    if (parsed.origin !== expectedOrigin || parsed.pathname !== "/" || parsed.search || parsed.hash) return false;
  }
  const digits = (key: string) => (environment[key] ?? "").replace(/\D/gu, "");
  const originFields = ["MELHOR_ENVIO_ORIGIN_NAME", "MELHOR_ENVIO_ORIGIN_EMAIL", "MELHOR_ENVIO_ORIGIN_PHONE",
    "MELHOR_ENVIO_ORIGIN_ADDRESS", "MELHOR_ENVIO_ORIGIN_NUMBER", "MELHOR_ENVIO_ORIGIN_DISTRICT",
    "MELHOR_ENVIO_ORIGIN_CITY", "MELHOR_ENVIO_ORIGIN_STATE", "MELHOR_ENVIO_ORIGIN_POSTAL_CODE"];
  const originComplete = originFields.every((key) => Boolean(environment[key]?.trim()))
    && /^\S+@\S+\.\S+$/u.test(environment.MELHOR_ENVIO_ORIGIN_EMAIL?.trim() ?? "")
    && /^\d{10,11}$/u.test(digits("MELHOR_ENVIO_ORIGIN_PHONE"))
    && /^[A-Za-z]{2}$/u.test(environment.MELHOR_ENVIO_ORIGIN_STATE?.trim() ?? "")
    && /^\d{8}$/u.test(digits("MELHOR_ENVIO_ORIGIN_POSTAL_CODE"))
    && (selected === "production"
      ? /^\d{14}$/u.test(digits("MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT"))
        && Boolean(environment.MELHOR_ENVIO_ORIGIN_STATE_REGISTER?.trim())
      : /^\d{11}$/u.test(digits("MELHOR_ENVIO_ORIGIN_DOCUMENT"))
        || /^\d{14}$/u.test(digits("MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT")));
  return parseEnvironmentBoolean(environment.MELHOR_ENVIO_ENABLED)
    && isValidHttpsUrl(environment.MELHOR_ENVIO_REDIRECT_URI)
    && Boolean(environment.MELHOR_ENVIO_CLIENT_ID?.trim())
    && Boolean(environment.MELHOR_ENVIO_CLIENT_SECRET?.trim())
    && isAes256Base64Key(environment.MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY)
    && Boolean(environment.MELHOR_ENVIO_APP_NAME?.trim())
    && Boolean(environment.MELHOR_ENVIO_TECHNICAL_CONTACT?.trim())
    && originComplete;
};

/** @deprecated Readiness is no longer based on environment token values. */
export const isMelhorEnvioSandboxReady = (environment: IntegrationEnvironment): boolean =>
  getMelhorEnvioEnvironment(environment) === "sandbox" && isMelhorEnvioConfigured(environment);

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
  const melhorEnvioEnabled = isMelhorEnvioConfigured(environment);
  // Never change the selected provider silently: an incomplete setup disables
  // checkout instead of substituting a different shipping price.
  const shippingProvider = requestedShippingProvider;
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
