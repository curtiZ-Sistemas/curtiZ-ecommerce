import { createHash } from "node:crypto";

export type AttachmentScanStatus = "clean" | "infected" | "suspicious" | "failed";
export interface AttachmentScanner {
  scan(input: { bytes: Uint8Array; mimeType: string; sha256: string; signal: AbortSignal }): Promise<{ verdict: unknown }>;
}

/** A provider must explicitly report clean for the exact immutable object being scanned. */
export async function scanAttachment(input: {
  bytes: Uint8Array; mimeType: string; expectedSha256: string; scanner?: AttachmentScanner;
}): Promise<AttachmentScanStatus> {
  if (!input.scanner || !/^[a-f0-9]{64}$/u.test(input.expectedSha256) || input.bytes.byteLength < 1
    || input.bytes.byteLength > 10 * 1024 * 1024) return "failed";
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  if (sha256 !== input.expectedSha256) return "suspicious";
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      input.scanner.scan({ bytes: input.bytes, mimeType: input.mimeType, sha256, signal: controller.signal }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => {
        controller.abort(); reject(new Error("scan_timeout"));
      }, 30_000); })
    ]);
    if (createHash("sha256").update(input.bytes).digest("hex") !== sha256) return "suspicious";
    return result.verdict === "clean" || result.verdict === "infected" || result.verdict === "suspicious"
      ? result.verdict : "failed";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timeout);
  }
}
