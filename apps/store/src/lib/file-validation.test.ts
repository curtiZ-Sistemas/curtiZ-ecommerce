import { describe, expect, it } from "vitest";
import { inspectUpload, type AcceptedUploadMime } from "./file-validation";

const allowed = new Set<AcceptedUploadMime>(["image/png", "application/pdf"]);

describe("inspeção binária de uploads", () => {
  it("aceita assinatura coerente com o MIME permitido", () => {
    const png = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13,0x49,0x48,0x44,0x52,0,0,0,100,0,0,0,50]);
    expect(inspectUpload(png, "image/png", allowed)).toEqual({
      mime: "image/png", extension: "png", width: 100, height: 50
    });
  });

  it("rejeita imagem com dimensões ausentes ou decompression bomb", () => {
    const headerOnly = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
    expect(inspectUpload(headerOnly, "image/png", allowed)).toBeNull();
    const huge = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13,0x49,0x48,0x44,0x52,0,0,0x27,0x10,0,0,0x27,0x10]);
    expect(inspectUpload(huge, "image/png", allowed)).toBeNull();
  });

  it("rejeita MIME forjado e formato fora da allowlist", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(inspectUpload(png, "application/pdf", allowed)).toBeNull();
    expect(inspectUpload(new TextEncoder().encode("arquivo"), "image/png", allowed)).toBeNull();
  });

  it("rejeita PDF com conteúdo ativo", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 /JavaScript (alert) %%EOF");
    expect(inspectUpload(pdf, "application/pdf", allowed)).toBeNull();
  });
});
