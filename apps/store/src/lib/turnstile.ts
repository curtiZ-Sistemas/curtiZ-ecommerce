import { randomUUID } from "node:crypto";

type TurnstileResponse = { success?: boolean };

export async function verifyTurnstile(request: Request, token: string | undefined): Promise<boolean> {
  if (process.env.TURNSTILE_ENABLED !== "true") return true;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !token) return false;
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
    const result = (await response.json()) as TurnstileResponse;
    return result.success === true;
  } catch {
    return false;
  }
}

