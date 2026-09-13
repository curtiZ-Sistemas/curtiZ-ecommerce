import "server-only";

export class PrivateRequestError extends Error {
  constructor(public readonly status: number) {
    super("private_request_rejected");
  }
}

/** Enforce actual streamed bytes, including requests without Content-Length. */
export async function readBoundedBody(request: Request, maximumBytes: number): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > maximumBytes) {
    throw new PrivateRequestError(413);
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
      if (length > maximumBytes) {
        await reader.cancel();
        throw new PrivateRequestError(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readPrivateJson(request: Request, maximumBytes = 16_384): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new PrivateRequestError(415);
  }
  const body = await readBoundedBody(request, maximumBytes);
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    throw new PrivateRequestError(400);
  }
}

type RateClient = {
  rpc(name: string, args: Record<string, string>): PromiseLike<{ data: unknown; error: unknown }>;
};

export async function requirePrivateRateLimit(client: RateClient, scope: string) {
  const result = await client.rpc("consume_private_api_rate_limit", { p_scope: scope });
  if (result.error || typeof result.data !== "boolean") throw new PrivateRequestError(503);
  if (!result.data) throw new PrivateRequestError(429);
}
