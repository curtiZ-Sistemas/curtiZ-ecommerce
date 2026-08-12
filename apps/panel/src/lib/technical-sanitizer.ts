export type TechnicalRecord = Record<string, unknown>;

const sensitiveKey = /(authorization|cookie|password|passwd|secret|token|credential|cpf|card|payload|idempotency)/i;
const emailPattern = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g;
const bearerPattern = /bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const cpfPattern = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const jwtPattern = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const apiKeyPattern = /\b(?:(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{12,}|(?:sk|pk)-[A-Za-z0-9_-]{16,})\b/g;
const connectionUrlPattern = /\b(?:postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^\s"']+/gi;
const inlineCredentialPattern = /\b(api[_-]?key|secret|token|password)\s*[:=]\s*[^\s,;]+/gi;

function redactText(value: string): string {
  return value
    .replaceAll(bearerPattern, "Bearer [REDACTED]")
    .replaceAll(emailPattern, "[EMAIL]")
    .replaceAll(cpfPattern, "[CPF]")
    .replaceAll(jwtPattern, "[JWT]")
    .replaceAll(apiKeyPattern, "[API_KEY]")
    .replaceAll(connectionUrlPattern, "[CONNECTION_URL]")
    .replaceAll(inlineCredentialPattern, "$1=[REDACTED]")
    .slice(0, 4_000);
}

export function sanitizeTechnicalValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[TRUNCATED]";
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeTechnicalValue(item, depth + 1));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as TechnicalRecord)
        .slice(0, 100)
        .map(([key, item]) => [
          key,
          sensitiveKey.test(key) ? "[REDACTED]" : sanitizeTechnicalValue(item, depth + 1)
        ])
    );
  }
  return null;
}
