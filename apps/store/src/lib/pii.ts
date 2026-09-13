import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

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

/** v1 stores an unpadded base64url IV, authentication tag and ciphertext. */
export const decryptPII = (ciphertext: string): string => {
  try {
    const secret = process.env.PII_ENCRYPTION_KEY;
    if (!secret || secret.length < 32) throw new Error();
    const parts = ciphertext.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") throw new Error();
    const decoded = parts.slice(1).map((part) => {
      if (!/^[A-Za-z0-9_-]*$/u.test(part)) throw new Error();
      const bytes = Buffer.from(part, "base64url");
      if (bytes.toString("base64url") !== part) throw new Error();
      return bytes;
    });
    const [iv, tag, encrypted] = decoded;
    if (!iv || !tag || !encrypted || iv.length !== 12 || tag.length !== 16) throw new Error();
    const key = createHash("sha256").update(secret, "utf8").digest();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plainText = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return new TextDecoder("utf-8", { fatal: true }).decode(plainText);
  } catch {
    // Do not attach the input, key or underlying crypto error to this exception.
    throw new Error("PII decryption failed");
  }
};
