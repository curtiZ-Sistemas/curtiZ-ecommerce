import "server-only";
export {
  RequestBodyError as PrivateRequestError,
  readBoundedBody,
  readBoundedJson as readPrivateJson
} from "@curtiz/security";

import { readBoundedBody as readBody, RequestBodyError as PrivateRequestError } from "@curtiz/security";

export async function readPrivateFormData(request: Request, maximumBytes: number): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw new PrivateRequestError(415);
  const body = await readBody(request, maximumBytes);
  try {
    return await new Response(body as BodyInit, { headers: { "content-type": contentType } }).formData();
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
