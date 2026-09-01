import { describe, expect, it } from "vitest";
import { hasProductVideoSignature } from "./product-video";

describe("product video validation", () => {
  it("recognizes MP4 and WebM magic bytes", () => {
    expect(hasProductVideoSignature(new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]), "video/mp4")).toBe(true);
    expect(hasProductVideoSignature(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), "video/webm")).toBe(true);
  });

  it("rejects a renamed or truncated file", () => {
    expect(hasProductVideoSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "video/mp4")).toBe(false);
    expect(hasProductVideoSignature(new Uint8Array([0x1a, 0x45]), "video/webm")).toBe(false);
  });
});
