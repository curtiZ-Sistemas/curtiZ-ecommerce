import { createCipheriv, createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptPII, encryptPII } from "./pii";

vi.mock("server-only", () => ({}));
const secret = "isolated-test-encryption-secret-32-bytes";
beforeEach(() => vi.stubEnv("PII_ENCRYPTION_KEY", secret));
afterEach(() => vi.unstubAllEnvs());

describe("PII AES-256-GCM v1", () => {
  it("reads the existing v1 format independently of encryptPII", () => {
    const iv = Buffer.alloc(12, 7);
    const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
    const bytes = Buffer.concat([cipher.update("52998224725"), cipher.final()]);
    const stored = `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${bytes.toString("base64url")}`;
    expect(decryptPII(stored)).toBe("52998224725");
    expect(decryptPII(encryptPII("ação"))).toBe("ação");
  });
  it("uses a fresh IV on every encryption", () => {
    expect(encryptPII("52998224725")).not.toBe(encryptPII("52998224725"));
  });
  it.each([0, 1, 2, 3])("fails closed if v1 part %s is tampered", index => {
    const parts = encryptPII("52998224725").split(".");
    const part = parts[index] ?? "";
    parts[index] = part[0] === "A" ? `B${part.slice(1)}` : `A${part.slice(1)}`;
    expect(() => decryptPII(parts.join("."))).toThrow("PII decryption failed");
  });
  it.each(["", "v2.a.b.c", "v1.a.b.c", "v1...", "v1.!.?.=", "v1.a.b.c.extra"])("rejects invalid ciphertext", value => {
    expect(() => decryptPII(value)).toThrow("PII decryption failed");
  });
  it.each(["", "short", "another-isolated-encryption-key-32-bytes"])("rejects missing/incorrect keys without logging input", key => {
    const stored = encryptPII("52998224725");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("PII_ENCRYPTION_KEY", key);
    expect(() => decryptPII(stored)).toThrow(/^PII decryption failed$/);
    expect(log).not.toHaveBeenCalled(); log.mockRestore();
  });
});
