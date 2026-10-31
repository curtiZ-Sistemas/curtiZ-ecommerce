import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { issueRecoveryProof, verifyRecoveryProof, RECOVERY_PROOF_SECONDS } from "./recovery-proof";
const key = "test-only-recovery-signing-key-at-least-32-bytes";
const updated = "2026-10-22T12:00:00Z";
const jwt = (sub = "owner", sid = "session-one") => `header.${Buffer.from(JSON.stringify({ sub, session_id: sid })).toString("base64url")}.signature`;
describe("server-issued recovery provenance", () => {
  it("binds a short-lived proof to the verified user, session and user version", () => {
    const proof = issueRecoveryProof(jwt(), "owner", updated, key, 1000);
    expect(proof).not.toBeNull();
    expect(verifyRecoveryProof(proof!, jwt(), "owner", updated, key, 1001)).toBe(true);
    expect(verifyRecoveryProof(proof!, jwt("owner", "other-session"), "owner", updated, key, 1001)).toBe(false);
    expect(verifyRecoveryProof(proof!, jwt("other"), "other", updated, key, 1001)).toBe(false);
    expect(verifyRecoveryProof(proof!, jwt(), "owner", updated + "-changed", key, 1001)).toBe(false);
    expect(verifyRecoveryProof(proof!, jwt(), "owner", updated, key, 1000 + RECOVERY_PROOF_SECONDS)).toBe(false);
    expect(verifyRecoveryProof(proof!, jwt(), "owner", updated, key, 900)).toBe(false);
  });
  it("rejects tampering, malformed signatures, missing configuration and mismatched claims", () => {
    const proof = issueRecoveryProof(jwt(), "owner", updated, key, 1000)!;
    for (const invalid of [undefined, "", "x", proof + ".extra", proof.slice(0, -1), "A" + proof.slice(1)]) {
      expect(verifyRecoveryProof(invalid, jwt(), "owner", updated, key, 1001)).toBe(false);
    }
    expect(verifyRecoveryProof(proof, jwt(), "owner", updated, key + "different", 1001)).toBe(false);
    expect(verifyRecoveryProof(proof, jwt(), "owner", undefined, key, 1001)).toBe(false);
    expect(issueRecoveryProof(jwt("other"), "owner", updated, key, 1000)).toBeNull();
    expect(issueRecoveryProof(jwt(), "owner", updated, "short", 1000)).toBeNull();
    expect(issueRecoveryProof("invalid", "owner", updated, key, 1000)).toBeNull();
  });
});
