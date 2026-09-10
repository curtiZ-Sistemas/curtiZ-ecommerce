import { describe, expect, it } from "vitest";
import { deletionToken, validDeletionToken } from "./account-deletion-token";
describe("confirmação de exclusão", () => {
  it("vincula usuário e prazo e rejeita alterações", () => {
    const token = deletionToken("customer-a", "test-secret", 1000);
    expect(validDeletionToken(token, "customer-a", "test-secret", 2000)).toBe(true);
    expect(validDeletionToken(token, "customer-b", "test-secret", 2000)).toBe(false);
    expect(validDeletionToken(token, "customer-a", "test-secret", 301000)).toBe(false);
    expect(validDeletionToken(token, "customer-a", "different-secret", 2000)).toBe(false);
    for (const invalid of ["", "1.bad", token + ".extra", token.replace(/^./, "9")]) expect(validDeletionToken(invalid, "customer-a", "test-secret", 2000)).toBe(false);
  });
});
