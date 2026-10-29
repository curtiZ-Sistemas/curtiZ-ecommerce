type MfaClient = {
  auth: {
    mfa: {
      getAuthenticatorAssuranceLevel(): Promise<{
        data: { currentLevel: string | null } | null;
        error: unknown;
      }>;
    };
  };
};

export async function hasRequiredInternalMfa(client: MfaClient): Promise<boolean> {
  if (process.env.REQUIRE_INTERNAL_MFA !== "true") return true;
  try {
    const result = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    return !result.error && result.data?.currentLevel === "aal2";
  } catch {
    return false;
  }
}
