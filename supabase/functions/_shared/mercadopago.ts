import { requireEnv } from "./http.ts";

export const mercadoPagoRequest = async (
  path: string,
  init: RequestInit,
  idempotencyKey?: string
): Promise<Response> => {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${requireEnv("MERCADO_PAGO_ACCESS_TOKEN")}`);
  headers.set("content-type", "application/json");
  if (idempotencyKey) headers.set("x-idempotency-key", idempotencyKey);
  return fetch(`https://api.mercadopago.com${path}`, { ...init, headers });
};

export const validateMercadoPagoSignature = async (
  request: Request,
  dataId: string
): Promise<boolean> => {
  const signature = request.headers.get("x-signature");
  const requestId = request.headers.get("x-request-id");
  const secret = Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET");
  if (!signature || !requestId || !secret) return false;

  const parts = Object.fromEntries(signature.split(",").map((item) => item.trim().split("=")));
  const timestamp = parts.ts;
  const hash = parts.v1;
  if (!timestamp || !hash) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const expected = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (expected.length !== hash.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ hash.charCodeAt(index);
  }
  return difference === 0;
};
