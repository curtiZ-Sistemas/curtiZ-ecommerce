export type AcceptedUploadMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "video/mp4"
  | "application/pdf"
  | "application/zip";

const signatures: Array<{
  mime: AcceptedUploadMime;
  extension: string;
  matches: (bytes: Uint8Array) => boolean;
}> = [
  {
    mime: "image/jpeg",
    extension: "jpg",
    matches: (bytes) =>
      bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  },
  {
    mime: "image/png",
    extension: "png",
    matches: (bytes) =>
      bytes.length >= 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (value, index) => bytes[index] === value
      )
  },
  {
    mime: "image/webp",
    extension: "webp",
    matches: (bytes) =>
      ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP"
  },
  {
    mime: "video/mp4",
    extension: "mp4",
    matches: (bytes) => bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp"
  },
  {
    mime: "application/pdf",
    extension: "pdf",
    matches: (bytes) => ascii(bytes, 0, 5) === "%PDF-" && hasPdfEndMarker(bytes)
  },
  {
    mime: "application/zip",
    extension: "zip",
    matches: (bytes) =>
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      [[0x03, 0x04], [0x05, 0x06], [0x07, 0x08]].some(
        ([third, fourth]) => bytes[2] === third && bytes[3] === fourth
      )
  }
];

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.slice(start, end));

const hasPdfEndMarker = (bytes: Uint8Array): boolean => {
  const tail = ascii(bytes, Math.max(0, bytes.length - 1_024), bytes.length);
  return tail.includes("%%EOF");
};

const pdfHasActiveContent = (bytes: Uint8Array): boolean => {
  const contents = new TextDecoder("latin1").decode(bytes);
  return /\/(?:JavaScript|JS|Launch|EmbeddedFile|RichMedia)\b/iu.test(contents);
};

const byte = (bytes: Uint8Array, offset: number) => bytes[offset] ?? 0;
const uint24LittleEndian = (bytes: Uint8Array, offset: number) =>
  byte(bytes, offset) + (byte(bytes, offset + 1) << 8) + (byte(bytes, offset + 2) << 16);

const imageDimensions = (bytes: Uint8Array, mime: AcceptedUploadMime): { width: number; height: number } | null => {
  if (mime === "image/png" && bytes.length >= 24 && ascii(bytes, 12, 16) === "IHDR") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = byte(bytes, offset + 1);
      if (marker === 0xd9 || marker === 0xda) break;
      const length = (byte(bytes, offset + 2) << 8) + byte(bytes, offset + 3);
      if (length < 2 || offset + 2 + length > bytes.length) return null;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        return { height: (byte(bytes, offset + 5) << 8) + byte(bytes, offset + 6),
          width: (byte(bytes, offset + 7) << 8) + byte(bytes, offset + 8) };
      }
      offset += 2 + length;
    }
    return null;
  }
  if (mime === "image/webp" && bytes.length >= 30) {
    const chunk = ascii(bytes, 12, 16);
    if (chunk === "VP8X") return { width: uint24LittleEndian(bytes, 24) + 1,
      height: uint24LittleEndian(bytes, 27) + 1 };
    if (chunk === "VP8L" && byte(bytes, 20) === 0x2f) return {
      width: 1 + (((byte(bytes, 22) & 0x3f) << 8) | byte(bytes, 21)),
      height: 1 + (((byte(bytes, 24) & 0x0f) << 10) | (byte(bytes, 23) << 2) | ((byte(bytes, 22) & 0xc0) >> 6))
    };
    if (chunk === "VP8 " && bytes.length >= 30 && byte(bytes, 23) === 0x9d && byte(bytes, 24) === 0x01 && byte(bytes, 25) === 0x2a) {
      return { width: (byte(bytes, 26) | (byte(bytes, 27) << 8)) & 0x3fff,
        height: (byte(bytes, 28) | (byte(bytes, 29) << 8)) & 0x3fff };
    }
  }
  return null;
};

export const inspectUpload = (
  bytes: Uint8Array,
  declaredMime: string,
  allowed: ReadonlySet<AcceptedUploadMime>
): { mime: AcceptedUploadMime; extension: string; width?: number; height?: number } | null => {
  const detected = signatures.find((signature) => signature.matches(bytes));
  if (!detected || detected.mime !== declaredMime || !allowed.has(detected.mime)) return null;
  if (detected.mime === "application/pdf" && pdfHasActiveContent(bytes)) return null;
  if (["image/jpeg", "image/png", "image/webp"].includes(detected.mime)) {
    const dimensions = imageDimensions(bytes, detected.mime);
    if (!dimensions || dimensions.width < 1 || dimensions.height < 1
      || dimensions.width > 12_000 || dimensions.height > 12_000
      || dimensions.width * dimensions.height > 40_000_000) return null;
    return { mime: detected.mime, extension: detected.extension, ...dimensions };
  }
  return { mime: detected.mime, extension: detected.extension };
};
