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

export const decryptPII = (ciphertext: string, configuredSecret = process.env.PII_ENCRYPTION_KEY): string => {
  try {
    const secret = configuredSecret;
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
    const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret, "utf8").digest(), iv);
    decipher.setAuthTag(tag);
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat([decipher.update(encrypted), decipher.final()]));
  } catch { throw new Error("PII decryption failed"); }
};
