import { createHmac, timingSafeEqual } from "node:crypto";

export function deletionToken(userId: string, secret: string, now = Date.now()) {
  const expires = now + 5 * 60_000;
  const signature = createHmac("sha256", secret).update(`delete-account:${userId}:${expires}`).digest("hex");
  return `${expires}.${signature}`;
}

export function validDeletionToken(token: string, userId: string, secret: string, now = Date.now()) {
  const [expires, signature] = token.split(".");
  if (!expires || !signature || !/^\d+\.[a-f0-9]{64}$/.test(token)) return false;
  if (Number(expires) <= now || Number(expires) > now + 5 * 60_000) return false;
  const expected = createHmac("sha256", secret).update(`delete-account:${userId}:${expires}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
