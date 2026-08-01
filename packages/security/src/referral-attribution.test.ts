import { describe, expect, it } from "vitest";
import { createReferralAttribution, verifyReferralAttribution } from "./referral-attribution";

const secret = "referral-test-secret-with-more-than-32-characters";

describe("referral attribution", () => {
  it("normalizes, signs and verifies a referral code", () => {
    const token = createReferralAttribution(" curtiz-demo_1 ", secret);
    expect(token).toBeTruthy();
    expect(verifyReferralAttribution(token, secret)?.code).toBe("CURTIZ-DEMO_1");
  });

  it("rejects tampering, weak secrets and expired tokens", () => {
    const token = createReferralAttribution("CURTIZ123", secret, -1);
    expect(verifyReferralAttribution(token, secret)).toBeNull();
    expect(createReferralAttribution("CURTIZ123", "weak")).toBeNull();
    expect(verifyReferralAttribution(`${token}x`, secret)).toBeNull();
  });
});
