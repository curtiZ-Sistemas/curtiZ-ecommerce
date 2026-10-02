import { describe, expect, it } from "vitest";
import { getStoreEmailService } from "./store-email-health";
const now = Date.parse("2026-10-02T12:00:00Z");
const row = { state: "online", checked_at: new Date(now).toISOString(), error_summary: null };
describe("Resend indicator from store runtime", () => {
  it("does not require credentials in the panel", () => {
    expect(getStoreEmailService(row, now)).toMatchObject({ name: "Resend", state: "configured" });
  });
  it("distinguishes disabled configuration and processing failures", () => {
    expect(getStoreEmailService({ ...row, state: "not_configured", error_summary: "email_disabled" }, now).detail).toContain("desativado");
    expect(getStoreEmailService({ ...row, state: "awaiting_credentials", error_summary: "email_configuration_missing" }, now).detail).toContain("incompleta");
    expect(getStoreEmailService({ ...row, state: "degraded", error_summary: "email_processing_failed" }, now).state).toBe("degraded");
  });
  it("shows missing/stale/invalid heartbeat as unavailable", () => {
    expect(getStoreEmailService(null, now).state).toBe("unavailable");
    expect(getStoreEmailService(row, now + 16 * 60_000).state).toBe("unavailable");
    expect(getStoreEmailService({ ...row, checked_at: "invalid" }, now).state).toBe("unavailable");
  });
});
