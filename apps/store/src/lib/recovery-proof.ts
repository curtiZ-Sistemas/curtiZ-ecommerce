import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const RECOVERY_PROOF_COOKIE = "__Host-curtiz-recovery-proof";
export const RECOVERY_PROOF_SECONDS = 15 * 60;
const PURPOSE = "curtiz:password-recovery:v1:";

// Only use claims from a token just issued or validated by Supabase Auth.
export function readRecoveryClaims(token: string | undefined): Record<string, unknown> | null {
  try {
    if (!token || token.length > 16_384) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const value: unknown = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

export function issueRecoveryProof(accessToken: string, userId: string, updatedAt: string, key: string,
  now = Math.floor(Date.now() / 1000)): string | null {
  const claims = readRecoveryClaims(accessToken);
  if (key.length < 32 || claims?.sub !== userId || typeof claims.session_id !== "string" || !claims.session_id || !updatedAt) return null;
  const payload = Buffer.from(JSON.stringify({ sub: userId, sid: claims.session_id, updatedAt, at: now,
    expires: now + RECOVERY_PROOF_SECONDS })).toString("base64url");
  return `${payload}.${createHmac("sha256", key).update(PURPOSE + payload).digest("hex")}`;
}

export function verifyRecoveryProof(proof: string | undefined, accessToken: string | undefined,
  userId: string, updatedAt: string | undefined, key: string, now = Math.floor(Date.now() / 1000)): boolean {
  if (!proof || proof.length > 2048 || key.length < 32 || !updatedAt) return false;
  try {
    const [payload, signature, extra] = proof.split(".");
    if (!payload || !signature || extra || !/^[a-f0-9]{64}$/u.test(signature)) return false;
    const expected = createHmac("sha256", key).update(PURPOSE + payload).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return false;
    const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const grant = value as Record<string, unknown>;
    const claims = readRecoveryClaims(accessToken);
    return claims?.sub === userId && grant.sub === userId && typeof claims.session_id === "string"
      && grant.sid === claims.session_id && grant.updatedAt === updatedAt
      && typeof grant.at === "number" && Number.isInteger(grant.at) && grant.at <= now + 60
      && typeof grant.expires === "number" && grant.expires === grant.at + RECOVERY_PROOF_SECONDS
      && grant.expires > now;
  } catch { return false; }
}

export const recoveryProofCookieOptions = () => ({
  httpOnly: true, secure: true, sameSite: "strict" as const,
  path: "/", maxAge: RECOVERY_PROOF_SECONDS
});
