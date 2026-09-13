const textField = (value: unknown): string => (typeof value === "string" ? value : "");

const safeText = (value: unknown): string =>
  textField(value)
    .replace(/(?:Key \([^\n]*|Failing row contains[^\n]*)/giu, "[REDACTED]")
    .replace(/\b(?:TEST-|APP_USR-|sb_secret_|sb_publishable_)[\w.-]+/gu, "[REDACTED]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/gu, "[REDACTED]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, "[REDACTED]")
    .replace(/\b(?:\d[ .()-]*?){10,19}\b/gu, "[REDACTED]")
    .slice(0, 512);

export function safeDatabaseError(value: unknown) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const rawCode = textField(record.code);
  const code = /^[A-Za-z0-9_]{1,80}$/u.test(rawCode) ? rawCode : "";
  // Network/runtime exceptions can embed URLs or credentials; never log their text.
  return {
    code,
    message: code ? safeText(record.message) : "",
    details: code ? safeText(record.details) : "",
    hint: code ? safeText(record.hint) : ""
  };
}

export function isMissingAuthentication(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.name === "AuthSessionMissingError" ||
    record.status === 401 ||
    record.status === 403 ||
    [
      "session_not_found",
      "refresh_token_not_found",
      "refresh_token_already_used",
      "bad_jwt"
    ].includes(textField(record.code))
  );
}

export function isCheckoutBusinessError(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return [
    "checkout_line_unavailable",
    "insufficient stock",
    "invalid quantity",
    "invalid_coupon",
    "coupon_limit_reached",
    "invalid_checkout_lines",
    "invalid_checkout_payload",
    "duplicate_checkout_line",
    "invalid_coupon_lines",
    "order_not_eligible",
    "idempotency_conflict",
    "customer_identity_required",
    "invalid_payment_method"
  ].includes(textField(record.message));
}
