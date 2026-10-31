import { describe, expect, it } from "vitest";
import { homepageImageProxyUrl, isSafeHomepageImagePath } from "./homepage-media";

const path = "home-section-mobile-images/12345678-1234-4234-8234-123456789abc/mobile-12345678-1234-4234-8234-123456789abc.webp";

describe("URLs de imagens do construtor da home", () => {
  it("converte caminhos existentes do bucket para uma rota isolada de imagem promocional", () => {
    expect(homepageImageProxyUrl(path, "https://catalog.example.test")).toBe(`/media/homepage/${path}`);
    expect(homepageImageProxyUrl(`https://catalog.example.test/storage/v1/object/public/homepage-public/${path}`, "https://catalog.example.test"))
      .toBe(`/media/homepage/${path}`);
  });

  it("rejeita caminho de produto, vídeo e bucket ou domínio arbitrários", () => {
    expect(isSafeHomepageImagePath("products/user/product.webp")).toBe(false);
    expect(isSafeHomepageImagePath("home-section-videos/user/clip.mp4")).toBe(false);
    expect(isSafeHomepageImagePath("home-section-images/user/../product.webp")).toBe(false);
    expect(homepageImageProxyUrl("https://other.example.test/storage/v1/object/public/homepage-public/" + path, "https://catalog.example.test"))
      .toBe("");
  });
});
