import { readBoundedBody, RequestBodyError } from "./index";

export interface UploadImageBinding {
  info(stream: ReadableStream<Uint8Array>): Promise<{ width?: number; height?: number }>;
  input(stream: ReadableStream<Uint8Array>): {
    output(options: { format: "image/webp"; quality: number; anim: false }): Promise<{ response(): Response }>;
  };
}

/** Decode and re-encode through Workers Images, not a native Node dependency. */
export async function reencodeUploadImage(bytes: Uint8Array, binding: UploadImageBinding | undefined, maximumBytes: number) {
  if (!binding) throw new RequestBodyError(503);
  const stream = () => new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes); controller.close(); }
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const info = await binding.info(stream());
        const { width = 0, height = 0 } = info;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
          || width > 12_000 || height > 12_000 || width * height > 40_000_000) throw new RequestBodyError(422);
        // WebP output strips metadata; a single frame bounds animated-image expansion.
        const output = await binding.input(stream()).output({ format: "image/webp", quality: 90, anim: false });
        const response = output.response();
        if (!response.ok || !response.body) throw new RequestBodyError(422);
        return await readBoundedBody(new Request("https://image-output.invalid", {
          method: "POST", body: response.body, duplex: "half"
        } as RequestInit), maximumBytes);
      })(),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new RequestBodyError(503)), 15_000); })
    ]);
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError(422);
  } finally {
    clearTimeout(timeout);
  }
}
