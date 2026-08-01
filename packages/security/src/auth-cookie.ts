const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

export const normalizeCookieDomain = (value: string | undefined): string | null => {
  const normalized = value?.trim().toLowerCase().replace(/^\./u, "");
  if (!normalized || localHosts.has(normalized)) return null;
  if (
    normalized.includes(":") ||
    normalized.includes("/") ||
    normalized.includes(" ") ||
    !normalized.includes(".")
  ) {
    return null;
  }
  return normalized;
};

export const cookieDomainMatchesHost = (domain: string, host: string): boolean => {
  const normalizedHost = host.trim().toLowerCase().replace(/^\[|\]$/gu, "").split(":")[0] ?? "";
  return normalizedHost === domain || normalizedHost.endsWith(`.${domain}`);
};

export const sharedCookieOptions = <T>(
  options: T,
  host: string | null | undefined,
  configuredDomain = process.env.AUTH_COOKIE_DOMAIN
): T & { domain?: string } => {
  const domain = normalizeCookieDomain(configuredDomain);
  if (!domain || !host || !cookieDomainMatchesHost(domain, host)) {
    return options as T & { domain?: string };
  }
  return { ...options, domain: `.${domain}` };
};
