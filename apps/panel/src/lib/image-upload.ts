import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { reencodeUploadImage, RequestBodyError, type UploadImageBinding } from "@curtiz/security";

export async function prepareUploadImage(bytes: Uint8Array, maximumBytes: number) {
  let binding: UploadImageBinding | undefined;
  try {
    binding = (getCloudflareContext().env as unknown as { IMAGES?: UploadImageBinding }).IMAGES;
  } catch {
    throw new RequestBodyError(503);
  }
  return reencodeUploadImage(bytes, binding, maximumBytes);
}
