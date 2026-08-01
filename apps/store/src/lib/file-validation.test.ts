import { describe, expect, it } from "vitest";
import { inspectUpload, type AcceptedUploadMime } from "./file-validation";

const allowed = new Set<AcceptedUploadMime>(["image/png", "application/pdf"]);

describe("inspeção binária de uploads", () => {
  it("aceita assinatura coerente com o MIME permitido", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(inspectUpload(png, "image/png", allowed)).toEqual({
      mime: "image/png",
      extension: "png"
    });
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

