export const AUTH_PERSISTENCE_COOKIE = "curtiz-auth-persistence";

export type AuthPersistence = "persistent" | "session";

export function readAuthPersistence(value: string | undefined): AuthPersistence {
  return value === "persistent" ? "persistent" : "session";
}

export function applyAuthCookiePersistence<T extends { maxAge?: number; expires?: Date | string }>(
  options: T,
  persistence: AuthPersistence
): T {
  if (persistence === "persistent" || options.maxAge === 0) return options;
  const sessionOptions = { ...options };
  delete sessionOptions.maxAge;
  delete sessionOptions.expires;
  return sessionOptions;
}
