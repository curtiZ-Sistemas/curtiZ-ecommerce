type ProductImportImageMessage = { jobId: string; runId: string; productId: string };
type QueueMessage<T> = { body: T; attempts: number; ack(): void; retry(options?: { delaySeconds?: number }): void };
type MessageBatch<T> = { messages: QueueMessage<T>[] };
type ImageInfo = { width?: number; height?: number; format?: string };
type ImagesBinding = {
  info(stream: ReadableStream<Uint8Array>): Promise<ImageInfo>;
  input(stream: ReadableStream<Uint8Array>): {
    output(options: { format: "image/webp"; quality: number; anim: false }): Promise<{ response(): Response }>;
  };
};
export type Env = { SUPABASE_URL: string; SUPABASE_SECRET_KEY: string; IMAGES: ImagesBinding };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const text = (value: unknown) => typeof value === "string" ? value : "";

class JobError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly stage: string) { super(code); }
}

function messageIsValid(value: unknown): value is ProductImportImageMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 3 && UUID.test(String(item.jobId)) && UUID.test(String(item.runId)) && UUID.test(String(item.productId));
}

function config(env: Env) {
  let url: URL;
  try { url = new URL(env.SUPABASE_URL); } catch { throw new JobError("INVALID_WORKER_CONFIG", false, "config"); }
  if (url.protocol !== "https:" || url.pathname !== "/" || !env.SUPABASE_SECRET_KEY || !env.IMAGES) throw new JobError("INVALID_WORKER_CONFIG", false, "config");
  return { root: url.toString().replace(/\/$/u, ""), secret: env.SUPABASE_SECRET_KEY };
}

async function supabaseRpc(env: Env, name: string, body: Record<string, unknown>) {
  const { root, secret } = config(env);
  let response: Response;
  try {
    response = await fetch(`${root}/rest/v1/rpc/${name}`, {
      method: "POST", headers: { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15_000)
    });
  } catch { throw new JobError("DATABASE_UNAVAILABLE", true, "database"); }
  if (!response.ok) throw new JobError(response.status >= 500 || response.status === 429 ? "DATABASE_UNAVAILABLE" : "DATABASE_REJECTED", response.status >= 500 || response.status === 429, "database");
  return await response.json() as Record<string, unknown>;
}

function storageUrl(env: Env, path: string) {
  const { root } = config(env);
  return `${root}/storage/v1/object/authenticated/catalog-public/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function storageHeaders(env: Env) {
  const { secret } = config(env);
  return { apikey: secret, authorization: `Bearer ${secret}` };
}

function allowedSource(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "down-sg.img.susercontent.com" && !url.username && !url.password && !url.port;
  } catch { return false; }
}

async function boundedResponse(response: Response, stage: string) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new JobError("IMAGE_TOO_LARGE", false, stage);
  if (!response.body) throw new JobError("EMPTY_IMAGE", false, stage);
  let total = 0;
  const limited = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > MAX_BYTES) throw new JobError("IMAGE_TOO_LARGE", false, stage);
      controller.enqueue(chunk);
    }
  }));
  return { stream: limited, bytes: () => total };
}

async function downloadSource(source: string) {
  let current = source;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!allowedSource(current)) throw new JobError("IMAGE_HOST_NOT_ALLOWED", false, "download");
    let response: Response;
    try { response = await fetch(current, { redirect: "manual", headers: { accept: "image/webp,image/png,image/jpeg" }, signal: AbortSignal.timeout(15_000) }); }
    catch { throw new JobError("IMAGE_NETWORK_FAILURE", true, "download"); }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new JobError("INVALID_IMAGE_REDIRECT", false, "download");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new JobError(`IMAGE_CDN_${response.status}`, response.status === 408 || response.status === 429 || response.status >= 500, "download");
    const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!ALLOWED_MIME.has(mime)) throw new JobError("INVALID_IMAGE_MIME", false, "validate");
    return response;
  }
  throw new JobError("IMAGE_REDIRECT_LIMIT", false, "download");
}

async function inspectAndTransform(env: Env, response: Response) {
  const limited = await boundedResponse(response, "validate");
  const [infoStream, transformStream] = limited.stream.tee();
  let info: ImageInfo;
  try { info = await env.IMAGES.info(infoStream); }
  catch { throw new JobError("INVALID_IMAGE_CONTENT", false, "validate"); }
  const width = Number(info.width); const height = Number(info.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 12_000 || height > 12_000 || width * height > 40_000_000) {
    throw new JobError("INVALID_IMAGE_DIMENSIONS", false, "validate");
  }
  let transformed: Response;
  try {
    const output = await env.IMAGES.input(transformStream).output({ format: "image/webp", quality: 90, anim: false });
    transformed = output.response();
  }
  catch { throw new JobError("IMAGE_TRANSFORM_FAILED", true, "transform"); }
  if (!transformed.ok) throw new JobError("IMAGE_TRANSFORM_FAILED", transformed.status >= 500, "transform");
  return { response: transformed, width, height };
}

async function inspectStoredImage(env: Env, response: Response) {
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime !== "image/webp") throw new JobError("INVALID_STORED_IMAGE", false, "storage");
  const limited = await boundedResponse(response, "storage");
  let info: ImageInfo;
  try { info = await env.IMAGES.info(limited.stream); }
  catch { throw new JobError("INVALID_STORED_IMAGE", false, "storage"); }
  const width = Number(info.width); const height = Number(info.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 12_000 || height > 12_000 || width * height > 40_000_000) {
    throw new JobError("INVALID_STORED_IMAGE", false, "storage");
  }
  return { width, height, size: limited.bytes() };
}

async function existingStorageObject(env: Env, path: string) {
  let response: Response;
  try { response = await fetch(storageUrl(env, path), { headers: storageHeaders(env), signal: AbortSignal.timeout(15_000) }); }
  catch { throw new JobError("STORAGE_UNAVAILABLE", true, "storage"); }
  if (response.status === 404) return null;
  if (!response.ok) throw new JobError("STORAGE_UNAVAILABLE", response.status >= 500 || response.status === 429, "storage");
  return response;
}

async function upload(env: Env, path: string, response: Response) {
  const limited = await boundedResponse(response, "upload");
  let stored: Response;
  try {
    stored = await fetch(storageUrl(env, path).replace("/object/authenticated/", "/object/"), {
      method: "POST", headers: { ...storageHeaders(env), "content-type": "image/webp", "cache-control": "max-age=31536000", "x-upsert": "true" },
      body: limited.stream, signal: AbortSignal.timeout(30_000)
    });
  } catch { throw new JobError("STORAGE_UNAVAILABLE", true, "upload"); }
  if (!stored.ok) throw new JobError("STORAGE_UPLOAD_FAILED", stored.status >= 500 || stored.status === 429, "upload");
  return limited.bytes();
}

export async function processProductImageMessage(message: ProductImportImageMessage, env: Env) {
  if (!messageIsValid(message)) throw new JobError("INVALID_QUEUE_MESSAGE", false, "message");
  const lockToken = crypto.randomUUID();
  const claimed = await supabaseRpc(env, "claim_product_import_image_job", { p_job_id: message.jobId, p_lock_token: lockToken });
  const state = text(claimed.state);
  if (["completed", "failed", "missing"].includes(state)) return { retry: false, state };
  if (state === "busy") return { retry: true, state };
  if (state !== "claimed" || claimed.productId !== message.productId) throw new JobError("INVALID_JOB_CLAIM", false, "claim");
  const sourceUrl = text(claimed.sourceUrl); const path = text(claimed.storagePath);
  try {
    const stored = await existingStorageObject(env, path);
    const processed = stored
      ? await inspectStoredImage(env, stored)
      : await (async () => {
          const transformed = await inspectAndTransform(env, await downloadSource(sourceUrl));
          return { width: transformed.width, height: transformed.height, size: await upload(env, path, transformed.response) };
        })();
    await supabaseRpc(env, "complete_product_import_image_job", {
      p_job_id: message.jobId, p_lock_token: lockToken,
      p_width: processed.width, p_height: processed.height, p_size_bytes: processed.size
    });
    return { retry: false, state: "completed" };
  } catch (error) {
    const failure = error instanceof JobError ? error : new JobError("UNEXPECTED_IMAGE_FAILURE", true, "unknown");
    const failed = await supabaseRpc(env, "fail_product_import_image_job", {
      p_job_id: message.jobId, p_lock_token: lockToken, p_error_code: failure.code, p_retryable: failure.retryable
    });
    console.warn(JSON.stringify({ runId: message.runId, jobId: message.jobId, productId: message.productId, stage: failure.stage, attempt: claimed.attempt, code: failure.code }));
    return { retry: failed.retry === true, state: text(failed.state) || "failed" };
  }
}

export default {
  async queue(batch: MessageBatch<unknown>, env: Env) {
    for (const message of batch.messages) {
      if (!messageIsValid(message.body)) { message.ack(); continue; }
      try {
        const result = await processProductImageMessage(message.body, env);
        if (result.retry) message.retry({ delaySeconds: 30 }); else message.ack();
      } catch (error) {
        const retryable = !(error instanceof JobError) || error.retryable;
        console.error(JSON.stringify({ runId: message.body.runId, jobId: message.body.jobId, productId: message.body.productId, stage: error instanceof JobError ? error.stage : "unknown", attempt: message.attempts, code: error instanceof JobError ? error.code : "UNEXPECTED_WORKER_FAILURE" }));
        if (retryable) message.retry({ delaySeconds: 30 }); else message.ack();
      }
    }
  }
};
