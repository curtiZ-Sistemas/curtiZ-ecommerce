import { describe, expect, it } from "vitest";
import { privacyRequestDeclarationReference } from "./privacy-request-deadline";

describe("privacyRequestDeclarationReference", () => {
  it("calculates a reference across month and year boundaries for confirmation and access", () => {
    expect(privacyRequestDeclarationReference("confirmation", "2026-12-25T15:30:00Z"))
      .toBe("2027-01-09T15:30:00.000Z");
    expect(privacyRequestDeclarationReference("access", "2026-02-20T03:00:00Z"))
      .toBe("2026-03-07T03:00:00.000Z");
  });

  it("does not assign this deadline to other requests or invalid dates", () => {
    expect(privacyRequestDeclarationReference("deletion", "2026-01-01T00:00:00Z")).toBeNull();
    expect(privacyRequestDeclarationReference("access", "not-a-date")).toBeNull();
    expect(privacyRequestDeclarationReference("access", null)).toBeNull();
  });
});
