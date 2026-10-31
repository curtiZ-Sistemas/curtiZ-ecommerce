import { randomUUID } from "node:crypto";

export async function verifyTurnstile(request: Request, token: string | undefined, action: string): Promise<boolean> {
  if (process.env.TURNSTILE_ENABLED !== "true") return true;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const hosts = new Set((process.env.TURNSTILE_HOSTNAMES ?? "").split(",").map(host => host.trim()).filter(Boolean));
  const hostname = new URL(request.url).hostname;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  if (!secret || !token || token.length > 2048 || !hosts.has(hostname)
    || (process.env.APP_ENV === "production" && local) || !/^[a-zA-Z0-9_-]{1,32}$/u.test(action)) return false;
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? "";
  const body = new URLSearchParams({
    secret,
    response: token,
    idempotency_key: randomUUID(),
    ...(ip ? { remoteip: ip } : {})
  });
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) return false;
    const result: unknown = await response.json();
    return typeof result === "object" && result !== null && "success" in result && result.success === true
      && "hostname" in result && result.hostname === hostname && "action" in result && result.action === action;
  } catch {
    return false;
  }
}

