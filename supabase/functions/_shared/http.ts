export const corsHeaders = {
  "access-control-allow-origin": Deno.env.get("ALLOWED_ORIGIN") ?? "http://localhost:3000",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-signature, x-request-id",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json"
};

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "cache-control": "private, no-store" } });

export class BodyLimitError extends Error {
  constructor(readonly status: number) { super("invalid_request_body"); }
}

export async function readRawBody(request: Request, maximumBytes: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) throw new BodyLimitError(400);
    if (length > maximumBytes) throw new BodyLimitError(413);
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) { await reader.cancel(); throw new BodyLimitError(413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
  return bytes;
}

export async function readJson(request: Request, maximumBytes=16_384): Promise<unknown> {
  try {
    if (request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase() !== "application/json") throw new BodyLimitError(415);
    return JSON.parse(new TextDecoder().decode(await readRawBody(request,maximumBytes))) as unknown;
  } catch (error) {
    return json({ error: "invalid_request_body" },error instanceof BodyLimitError ? error.status : 400);
  }
}

export const requestId = (request: Request): string =>
  request.headers.get("x-request-id") ?? crypto.randomUUID();

export const requireEnv = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
};
