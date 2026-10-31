import { describe, expect, it, vi } from "vitest";
import { reencodeUploadImage, type UploadImageBinding } from "./index";

const bytes = new Uint8Array([1, 2, 3]);
const binding = (width = 100, height = 100) => ({
  info: vi.fn(async () => ({ width, height })),
  input: vi.fn(() => ({ output: vi.fn(async () => ({ response: () => new Response(bytes) })) }))
});

describe("Workers image sanitation", () => {
  it("fails closed without the decoder", async () => {
    await expect(reencodeUploadImage(bytes, undefined, 1024)).rejects.toMatchObject({ status: 503 });
  });
  it("rejects excess dimensions before decode/reencode", async () => {
    const images = binding(10_000, 10_000);
    await expect(reencodeUploadImage(bytes, images, 1024)).rejects.toMatchObject({ status: 422 });
    expect(images.input).not.toHaveBeenCalled();
  });
  it("requests metadata-free single-frame WebP output", async () => {
    const output = vi.fn(async () => ({ response: () => new Response(bytes) }));
    const images: UploadImageBinding = { info: async () => ({ width: 100, height: 100 }), input: () => ({ output }) };
    expect(await reencodeUploadImage(bytes, images, 1024)).toEqual(bytes);
    expect(output).toHaveBeenCalledWith({ format: "image/webp", quality: 90, anim: false });
  });
  it("rejects decode failures and oversized output", async () => {
    const images = binding();
    images.info.mockRejectedValue(new Error("invalid image"));
    await expect(reencodeUploadImage(bytes, images, 1024)).rejects.toMatchObject({ status: 422 });
    await expect(reencodeUploadImage(bytes, binding(), 2)).rejects.toMatchObject({ status: 413 });
  });
});
