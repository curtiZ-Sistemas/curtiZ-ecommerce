import { createCipheriv, createHash, randomBytes } from "node:crypto";

export const encryptPII = (plainText: string): string => {
  const secret = process.env.PII_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("PII encryption is not configured");
  const key = createHash("sha256").update(secret, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
};
