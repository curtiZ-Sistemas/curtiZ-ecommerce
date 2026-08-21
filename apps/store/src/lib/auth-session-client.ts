export type PublicAuthSession = {
  authenticated: boolean;
  fullName?: string;
  roles?: string[];
  persistent?: boolean;
};

let pendingSession: Promise<PublicAuthSession> | null = null;

export function fetchPublicAuthSession(): Promise<PublicAuthSession> {
  if (pendingSession) return pendingSession;

  pendingSession = fetch("/api/auth/session", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return { authenticated: false };
      const value: unknown = await response.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { authenticated: false };
      }
      const session = value as Record<string, unknown>;
      return {
        authenticated: session.authenticated === true,
        ...(typeof session.fullName === "string" ? { fullName: session.fullName } : {}),
        ...(Array.isArray(session.roles)
          ? { roles: session.roles.filter((role): role is string => typeof role === "string") }
          : {}),
        ...(typeof session.persistent === "boolean" ? { persistent: session.persistent } : {})
      };
    })
    .catch(() => ({ authenticated: false }))
    .finally(() => {
      pendingSession = null;
    });

  return pendingSession;
}
