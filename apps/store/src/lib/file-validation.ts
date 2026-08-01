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

export const inspectUpload = (
  bytes: Uint8Array,
  declaredMime: string,
  allowed: ReadonlySet<AcceptedUploadMime>
): { mime: AcceptedUploadMime; extension: string } | null => {
  const detected = signatures.find((signature) => signature.matches(bytes));
  if (!detected || detected.mime !== declaredMime || !allowed.has(detected.mime)) return null;
  if (detected.mime === "application/pdf" && pdfHasActiveContent(bytes)) return null;
  return { mime: detected.mime, extension: detected.extension };
};

