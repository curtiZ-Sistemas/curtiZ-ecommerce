import { describe, expect, it } from "vitest";
import {
  isCheckoutBusinessError,
  isMissingAuthentication,
  safeDatabaseError
} from "./checkout-diagnostics";

describe("checkout diagnostics", () => {
  it("preserves schema diagnostics without personal data or credentials", () => {
    const result = safeDatabaseError({
      code: "PGRST202",
      message: "function missing",
      details: "person@example.com CPF 529.982.247-25 TEST-secret",
      hint: "Key (email)=(person@example.com) already exists."
    });
    expect(result.code).toBe("PGRST202");
    expect(result.message).toBe("function missing");
    expect(JSON.stringify(result)).not.toMatch(/person@|529|TEST-secret/u);
    expect(result.hint).toBe("[REDACTED]");
  });
  it("does not expose arbitrary runtime exceptions", () => {
    expect(safeDatabaseError(new Error("https://secret@host"))).toEqual({
      code: "",
      message: "",
      details: "",
      hint: ""
    });
  });
  it("distinguishes missing sessions from an authentication outage", () => {
    expect(isMissingAuthentication({ name: "AuthSessionMissingError" })).toBe(true);
    expect(isMissingAuthentication({ status: 503 })).toBe(false);
  });
  it("does not disguise database failures as price or stock conflicts", () => {
    expect(isCheckoutBusinessError({ code: "P0001", message: "checkout_line_unavailable" })).toBe(
      true
    );
    expect(isCheckoutBusinessError({ code: "P0001", message: "insufficient stock" })).toBe(true);
    expect(isCheckoutBusinessError({ code: "PGRST202", message: "function missing" })).toBe(false);
    expect(isCheckoutBusinessError(null)).toBe(false);
  });
});
