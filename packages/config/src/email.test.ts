import { describe, expect, it } from "vitest";
import { emailAddress, getResendReadiness } from "./email";
import { getIntegrationConfig } from "./integrations";
import { serverEnvSchema } from "./index";
const ready = { EMAIL_PROVIDER: "resend", EMAIL_ENABLED: "true", RESEND_API_KEY: "test-only-key",
  EMAIL_FROM: "curti Z <pedidos@example.com>", NEXT_PUBLIC_STORE_URL: "https://store.example.com" };
describe("Resend runtime readiness", () => {
  it("accepts blank optional email bindings when sending is disabled", () => {
    expect(serverEnvSchema.safeParse({ SUPABASE_URL: "https://test.supabase.co", SUPABASE_PUBLISHABLE_KEY: "test-key",
      EMAIL_PROVIDER: "disabled", EMAIL_ENABLED: "false", RESEND_API_KEY: "", EMAIL_FROM: "", RESEND_FROM_EMAIL: "", EMAIL_REPLY_TO: "" }).success).toBe(true);
  });
  it("requires both provider selection and explicit enabled flag", () => {
    expect(getResendReadiness(ready).configured).toBe(true);
    for (const EMAIL_ENABLED of [undefined, "false", "0", "no"]) {
      expect(getResendReadiness({ ...ready, EMAIL_ENABLED }).configured).toBe(false);
      expect(getIntegrationConfig({ ...ready, EMAIL_ENABLED }).email.enabled).toBe(false);
    }
    expect(getResendReadiness({ ...ready, EMAIL_PROVIDER: "mock" }).configured).toBe(false);
  });
  it.each(["RESEND_API_KEY", "EMAIL_FROM", "NEXT_PUBLIC_STORE_URL"])("fails closed without %s", (key) => {
    expect(getResendReadiness({ ...ready, [key]: "" }).configured).toBe(false);
  });
  it("uses legacy sender only as fallback and supports a real reply mailbox", () => {
    expect(getResendReadiness({ ...ready, EMAIL_FROM: "", RESEND_FROM_EMAIL: "fiscal@example.com" }).from).toBe("fiscal@example.com");
    expect(getResendReadiness(ready).replyTo).toBe("pedidos@example.com");
    expect(emailAddress("curti Z <pedidos@example.com>\r\nBcc:other@example.com")).toBeNull();
    expect(emailAddress("pedidos@example.com>")).toBeNull();
    expect(getIntegrationConfig({ ...ready, RESEND_API_KEY: "" }).email.enabled).toBe(false);
  });
  it.each(["http://store.example.com", "https://store.example.com/path", "https://user:pass@store.example.com", "javascript:alert(1)"])("rejects unsafe origin %s", (url) => {
    expect(getResendReadiness({ ...ready, NEXT_PUBLIC_STORE_URL: url }).configured).toBe(false);
  });
});
