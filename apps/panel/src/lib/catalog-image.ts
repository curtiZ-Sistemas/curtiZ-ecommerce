export type CatalogImageInfo = {
  extension: "jpg" | "png" | "webp";
  mime: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
};

const uint16 = (bytes: Uint8Array, offset: number, little = false) =>
  little ? bytes[offset]! | (bytes[offset + 1]! << 8) : (bytes[offset]! << 8) | bytes[offset + 1]!;
const uint24 = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
const uint32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;

export function inspectCatalogImage(bytes: Uint8Array): CatalogImageInfo | null {
  if (bytes.length >= 24 && [0x89, 0x50, 0x4e, 0x47].every((value, index) => bytes[index] === value)) {
    return { extension: "png", mime: "image/png", width: uint32(bytes, 16), height: uint32(bytes, 20) };
  }
  if (bytes.length >= 30 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") {
    const type = new TextDecoder().decode(bytes.slice(12, 16));
    if (type === "VP8X") return { extension: "webp", mime: "image/webp", width: uint24(bytes, 24) + 1, height: uint24(bytes, 27) + 1 };
    if (type === "VP8L") return { extension: "webp", mime: "image/webp", width: 1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8), height: 1 + (bytes[22]! >> 6) + (bytes[23]! << 2) + ((bytes[24]! & 0x0f) << 10) };
    if (type === "VP8 ") return { extension: "webp", mime: "image/webp", width: uint16(bytes, 26, true) & 0x3fff, height: uint16(bytes, 28, true) & 0x3fff };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1]!;
      const length = uint16(bytes, offset + 2);
      if (new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]).has(marker)) {
        return { extension: "jpg", mime: "image/jpeg", height: uint16(bytes, offset + 5), width: uint16(bytes, offset + 7) };
      }
      if (length < 2) break;
      offset += length + 2;
    }
  }
  return null;
}
