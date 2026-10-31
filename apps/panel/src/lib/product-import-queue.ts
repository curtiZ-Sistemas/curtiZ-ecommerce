import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export type ProductImportImageMessage = {
  jobId: string;
  runId: string;
  productId: string;
};

type QueueProducer = {
  sendBatch(messages: Array<{ body: ProductImportImageMessage }>): Promise<void>;
};

const MAX_QUEUE_BATCH = 100;

export async function enqueueProductImportImages(messages: readonly ProductImportImageMessage[]) {
  if (!messages.length) return;
  let queue: QueueProducer | undefined;
  try {
    queue = (getCloudflareContext().env as unknown as { PRODUCT_IMPORT_IMAGES?: QueueProducer }).PRODUCT_IMPORT_IMAGES;
  } catch {
    throw new Error("PRODUCT_IMPORT_QUEUE_UNAVAILABLE");
  }
  if (!queue) throw new Error("PRODUCT_IMPORT_QUEUE_UNAVAILABLE");
  for (let offset = 0; offset < messages.length; offset += MAX_QUEUE_BATCH) {
    await queue.sendBatch(messages.slice(offset, offset + MAX_QUEUE_BATCH).map((body) => ({ body })));
  }
}
