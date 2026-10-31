const key = "curtiz.shipping-postal-code.v1";
const lifetime = 30 * 60_000;

export function rememberShippingPostalCode(postalCode: string) {
  const digits = postalCode.replace(/\D/gu, "");
  if (!/^\d{8}$/u.test(digits)) return;
  try { sessionStorage.setItem(key, JSON.stringify({ postalCode: digits, until: Date.now() + lifetime })); }
  catch { /* Browsers may disable session storage. */ }
}

export function readShippingPostalCode(): string {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (typeof stored === "object" && stored !== null && "postalCode" in stored && "until" in stored
      && typeof stored.postalCode === "string" && /^\d{8}$/u.test(stored.postalCode)
      && typeof stored.until === "number" && stored.until > Date.now()) return stored.postalCode;
    sessionStorage.removeItem(key);
  } catch { /* Invalid or disabled storage is not a checkout failure. */ }
  return "";
}
