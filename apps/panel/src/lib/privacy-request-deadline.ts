const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

/** Reference for the complete declaration described in LGPD art. 19. */
export function privacyRequestDeclarationReference(type: unknown, requestedAt: unknown): string | null {
  if ((type !== "confirmation" && type !== "access") || typeof requestedAt !== "string") return null;
  const timestamp = Date.parse(requestedAt);
  if (!Number.isFinite(timestamp)) return null;
  const deadline = new Date(timestamp + FIFTEEN_DAYS_MS);
  return Number.isFinite(deadline.getTime()) ? deadline.toISOString() : null;
}
