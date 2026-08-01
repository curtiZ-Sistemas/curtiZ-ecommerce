import { createHmac, timingSafeEqual } from "node:crypto";

export const REFERRAL_ATTRIBUTION_COOKIE = "curtiz_referral";

type ReferralAttribution = { code: string; expiresAt: number };

const normalizeCode = (code: string) => code.trim().toUpperCase();

export const createReferralAttribution = (
  code: string,
  secret: string,
  lifetimeSeconds = 30 * 24 * 60 * 60
): string | null => {
  const normalized = normalizeCode(code);
  if (!/^[A-Z0-9_-]{4,32}$/u.test(normalized) || secret.length < 32) return null;
  const payload = Buffer.from(
    JSON.stringify({ code: normalized, expiresAt: Math.floor(Date.now() / 1000) + lifetimeSeconds })
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
};

export const verifyReferralAttribution = (
  token: string | null | undefined,
  secret: string
): ReferralAttribution | null => {
  if (!token || secret.length < 32) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<ReferralAttribution>;
    if (
      typeof candidate.code !== "string" ||
      !/^[A-Z0-9_-]{4,32}$/u.test(candidate.code) ||
      typeof candidate.expiresAt !== "number" ||
      candidate.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return { code: candidate.code, expiresAt: candidate.expiresAt };
  } catch {
    return null;
  }
};
