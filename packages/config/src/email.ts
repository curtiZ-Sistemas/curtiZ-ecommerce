import type { IntegrationEnvironment } from "./integrations";

export const emailAddress = (value: string): string | null => {
  const match = value.match(/^(?:[^<>\r\n]+<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>|([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+))$/u);
  return match?.[1] ?? match?.[2] ?? null;
};

export function getResendReadiness(environment: IntegrationEnvironment) {
  const enabled = environment.EMAIL_PROVIDER?.trim().toLowerCase() === "resend"
    && ["true", "1", "yes"].includes(environment.EMAIL_ENABLED?.trim().toLowerCase() ?? "");
  const from = (environment.EMAIL_FROM || environment.RESEND_FROM_EMAIL)?.trim() ?? "";
  const replyTo = environment.EMAIL_REPLY_TO?.trim() || emailAddress(from) || "";
  const missing = ["RESEND_API_KEY", "NEXT_PUBLIC_STORE_URL"].filter((key) => !environment[key]?.trim());
  if (!from) missing.push("EMAIL_FROM");
  const invalid: string[] = [];
  if (from && !emailAddress(from)) invalid.push("EMAIL_FROM_INVALID");
  if (replyTo && !emailAddress(replyTo)) invalid.push("EMAIL_REPLY_TO_INVALID");
  const url = environment.NEXT_PUBLIC_STORE_URL?.trim();
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password)
        invalid.push("NEXT_PUBLIC_STORE_URL_INVALID");
    } catch { invalid.push("NEXT_PUBLIC_STORE_URL_INVALID"); }
  }
  return { enabled, configured: enabled && missing.length === 0 && invalid.length === 0, from, replyTo, missing, invalid };
}
