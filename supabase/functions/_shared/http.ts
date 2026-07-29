export const corsHeaders = {
  "access-control-allow-origin": Deno.env.get("ALLOWED_ORIGIN") ?? "http://localhost:3000",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-signature, x-request-id",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json"
};

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

export const requestId = (request: Request): string =>
  request.headers.get("x-request-id") ?? crypto.randomUUID();

export const requireEnv = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
};
