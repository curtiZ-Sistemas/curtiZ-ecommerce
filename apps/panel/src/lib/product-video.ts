export const MAX_PRODUCT_VIDEO_BYTES = 80 * 1024 * 1024;

export const productVideoExtension = {
  "video/mp4": "mp4",
  "video/webm": "webm"
} as const;

export type ProductVideoMime = keyof typeof productVideoExtension;

export function hasProductVideoSignature(bytes: Uint8Array, mimeType: ProductVideoMime) {
  if (mimeType === "video/mp4") {
    return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp";
  }
  return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}
