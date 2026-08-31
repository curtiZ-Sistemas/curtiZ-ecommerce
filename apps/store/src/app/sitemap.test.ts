import { beforeEach, describe, expect, it, vi } from "vitest";

const getActiveProductSitemapEntries = vi.hoisted(() => vi.fn());

vi.mock("@/lib/seo-data", () => ({ getActiveProductSitemapEntries }));

import sitemap from "./sitemap";

describe("sitemap público", () => {
  beforeEach(() => {
    getActiveProductSitemapEntries.mockResolvedValue([
      { slug: "slide-wave-preto", updatedAt: "2026-08-30T12:00:00.000Z" },
      { slug: "sandalia-luna" }
    ]);
  });

  it("inclui páginas indexáveis e produtos ativos usando somente o domínio oficial", async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain("https://curtiz.com.br/");
    expect(urls).toContain("https://curtiz.com.br/feminino");
    expect(urls).toContain("https://curtiz.com.br/produto/slide-wave-preto");
    expect(urls).toContain("https://curtiz.com.br/produto/sandalia-luna");
    expect(urls.some((url) => url.includes("workers.dev"))).toBe(false);
    expect(urls.some((url) => /\/(?:login|checkout|carrinho|minha-conta)(?:\/|$)/u.test(url))).toBe(
      false
    );
  });
});
