import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCustomerCheckoutCpf, resolveCheckoutPayerDocument, saveCustomerCheckoutIdentity } from "./checkout-identity";
import { decryptPII, encryptPII } from "./pii";
import { isValidCpf } from "./personal-data";

vi.mock("server-only", () => ({}));
beforeEach(() => vi.stubEnv("PII_ENCRYPTION_KEY", "isolated-customer-identity-secret-32-bytes"));
afterEach(() => vi.unstubAllEnvs());
const realCpf = "52998224725";
const identityDb = (patch = {}) => ({ rpc: vi.fn().mockResolvedValue({ data: {
  customerId: "customer-one", cpfCiphertext: encryptPII(realCpf), cpfLastFour: "4725", ...patch
}, error: null }) });

describe("private checkout identity", () => {
  it("TEST document uses only provider identity and does not read or overwrite stored CPF", async () => {
    const db = identityDb();
    expect(await resolveCheckoutPayerDocument(db, "customer-one", "12345678900", "test")).toBe("12345678900");
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each(["test", "production"] as const)("missing %s payer document falls back to authenticated customer's real CPF", async mode => {
    const db = identityDb();
    expect(await resolveCheckoutPayerDocument(db, "customer-one", "", mode)).toBe(realCpf);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("get_customer_checkout_identity", { p_customer_id: "customer-one" });
  });
  it("production compares the full real CPF, even when last4 collides", async () => {
    // Both CPFs have valid checksums and the same last4.
    const otherCpf = "00000044725";
    expect(isValidCpf(otherCpf)).toBe(true);
    const db = identityDb();
    await expect(resolveCheckoutPayerDocument(db, "customer-one", otherCpf, "production"))
      .rejects.toMatchObject({ code: "INVALID_PAYER_DOCUMENT" });
  });
  it.each([{ customerId: "customer-two" }, { cpfLastFour: "0000" }, { cpfCiphertext: "invalid-ciphertext" }])(
    "rejects foreign or inconsistent identity", async patch => {
      await expect(readCustomerCheckoutCpf(identityDb(patch), "customer-one"))
        .rejects.toMatchObject({ code: "CUSTOMER_IDENTITY_UNAVAILABLE" });
    });
  it("does not treat an invalid real CPF as a sandbox document", async () => {
    const db = identityDb({ cpfCiphertext: encryptPII("12345678900"), cpfLastFour: "8900" });
    await expect(resolveCheckoutPayerDocument(db, "customer-one", "", "test")).rejects.toThrow();
  });
  it("encrypts a changed CPF and writes last4 in the same RPC", async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: true, error: null }) };
    expect(await saveCustomerCheckoutIdentity(db, "customer-one", "123.456.789-09")).toBe("8909");
    const calls = db.rpc.mock.calls as Array<[string, Record<string, unknown>]>;
    const call = calls[0];
    if (!call) throw new Error("Expected identity write");
    const [name, args] = call;
    expect(name).toBe("save_customer_checkout_identity");
    expect(args).toMatchObject({ p_customer_id: "customer-one", p_cpf_last_four: "8909" });
    const ciphertext = args.p_cpf_ciphertext;
    expect(ciphertext).not.toContain("12345678909");
    if (typeof ciphertext !== "string") throw new Error("Expected encrypted customer identity");
    expect(decryptPII(ciphertext)).toBe("12345678909");
  });
  it.each(["", "11111111111", "12345678900"])("never writes invalid customer CPF", async cpf => {
    const db = identityDb();
    await expect(saveCustomerCheckoutIdentity(db, "customer-one", cpf)).rejects.toMatchObject({ code: "INVALID_CUSTOMER_CPF" });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
