import { requireEnv } from "./http.ts";

export const mercadoPagoRequest = async (
  path: string,
  init: RequestInit,
  idempotencyKey?: string
): Promise<Response> => {
  const accessToken = requireEnv("MERCADO_PAGO_ACCESS_TOKEN").trim();
  if (!accessToken.startsWith("TEST-")) {
    throw new Error("Mercado Pago test credential is required");
  }
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  headers.set("content-type", "application/json");
  if (idempotencyKey) headers.set("x-idempotency-key", idempotencyKey);
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new Error("Invalid provider path");
  return fetch(`https://api.mercadopago.com${path}`, { ...init, headers, redirect: "error", signal: init.signal ?? AbortSignal.timeout(15_000) });
};
