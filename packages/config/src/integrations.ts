import { getResendReadiness } from "./email";

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

export type MelhorEnvioReadiness = Readonly<{
  configured: boolean;
  missing: readonly string[];
  invalid: readonly string[];
}>;

export const getMelhorEnvioReadiness = (environment: IntegrationEnvironment): MelhorEnvioReadiness => {
  const missing = new Set<string>();
  const invalid = new Set<string>();
  const required = (name: string) => {
    if (!environment[name]?.trim()) missing.add(name);
  };
  const validWhenPresent = (name: string, predicate: (value: string) => boolean) => {
    const value = environment[name]?.trim() ?? "";
    if (value && !predicate(value)) invalid.add(`${name}_INVALID`);
  };
  const selected = getMelhorEnvioEnvironment(environment);
  if (!selected) invalid.add("MELHOR_ENVIO_ENVIRONMENT_INVALID");

  const legacyBaseUrl = environment.MELHOR_ENVIO_BASE_URL?.trim() ?? "";
  if (legacyBaseUrl && selected) {
    const expectedOrigin = selected === "sandbox"
      ? "https://sandbox.melhorenvio.com.br" : "https://melhorenvio.com.br";
    if (isValidHttpsUrl(legacyBaseUrl)) {
      const parsed = new URL(legacyBaseUrl);
      if (parsed.origin !== expectedOrigin || parsed.pathname !== "/" || parsed.search || parsed.hash) {
        invalid.add("MELHOR_ENVIO_BASE_URL_INVALID");
      }
    } else {
      invalid.add("MELHOR_ENVIO_BASE_URL_INVALID");
    }
  }

  if (!parseEnvironmentBoolean(environment.MELHOR_ENVIO_ENABLED)) invalid.add("MELHOR_ENVIO_ENABLED_DISABLED");
  required("MELHOR_ENVIO_REDIRECT_URI");
  validWhenPresent("MELHOR_ENVIO_REDIRECT_URI", isValidHttpsUrl);
  required("MELHOR_ENVIO_CLIENT_ID");
  required("MELHOR_ENVIO_CLIENT_SECRET");
  required("MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY");
  validWhenPresent("MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY", isAes256Base64Key);
  // Opcional: chaves anteriores aceitas só para decifrar durante a troca controlada da chave ativa.
  validWhenPresent("MELHOR_ENVIO_TOKEN_ENCRYPTION_PREVIOUS_KEYS",
    (value) => value.split(/[\s,]+/u).filter(Boolean).every(isAes256Base64Key));
  required("MELHOR_ENVIO_APP_NAME");
  required("MELHOR_ENVIO_TECHNICAL_CONTACT");
  validWhenPresent("MELHOR_ENVIO_TECHNICAL_CONTACT", (value) => /^\S+@\S+\.\S+$/u.test(value));

  const digits = (key: string) => (environment[key] ?? "").replace(/\D/gu, "");
  const originFields = ["MELHOR_ENVIO_ORIGIN_NAME", "MELHOR_ENVIO_ORIGIN_EMAIL", "MELHOR_ENVIO_ORIGIN_PHONE",
    "MELHOR_ENVIO_ORIGIN_ADDRESS", "MELHOR_ENVIO_ORIGIN_NUMBER", "MELHOR_ENVIO_ORIGIN_DISTRICT",
    "MELHOR_ENVIO_ORIGIN_CITY", "MELHOR_ENVIO_ORIGIN_STATE", "MELHOR_ENVIO_ORIGIN_POSTAL_CODE"];
  for (const name of originFields) required(name);
  validWhenPresent("MELHOR_ENVIO_ORIGIN_EMAIL", (value) => /^\S+@\S+\.\S+$/u.test(value));
  validWhenPresent("MELHOR_ENVIO_ORIGIN_PHONE", (value) => /^\d{10,11}$/u.test(value.replace(/\D/gu, "")));
  validWhenPresent("MELHOR_ENVIO_ORIGIN_STATE", (value) => /^[A-Za-z]{2}$/u.test(value));
  validWhenPresent("MELHOR_ENVIO_ORIGIN_POSTAL_CODE", (value) => /^\d{8}$/u.test(value.replace(/\D/gu, "")));

  if (selected === "production") {
    required("MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT");
    validWhenPresent("MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT", (value) => /^\d{14}$/u.test(value.replace(/\D/gu, "")));
    required("MELHOR_ENVIO_ORIGIN_STATE_REGISTER");
  } else if (selected === "sandbox") {
    const personalDocument = digits("MELHOR_ENVIO_ORIGIN_DOCUMENT");
    const companyDocument = digits("MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT");
    if (!personalDocument && !companyDocument) {
      missing.add("MELHOR_ENVIO_ORIGIN_DOCUMENT");
      missing.add("MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT");
    } else if (!/^\d{11}$/u.test(personalDocument) && !/^\d{14}$/u.test(companyDocument)) {
      if (personalDocument) invalid.add("MELHOR_ENVIO_ORIGIN_DOCUMENT_INVALID");
      if (companyDocument) invalid.add("MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT_INVALID");
    }
  }

  return { configured: missing.size === 0 && invalid.size === 0, missing: [...missing], invalid: [...invalid] };
};

export const isMelhorEnvioConfigured = (environment: IntegrationEnvironment): boolean =>
  getMelhorEnvioReadiness(environment).configured;

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
    getResendReadiness(environment).configured;
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
