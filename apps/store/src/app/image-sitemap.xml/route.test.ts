import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getEntries: vi.fn(),
  build: vi.fn()
}));

vi.mock("../../lib/seo-data", () => ({ getActiveProductImageSitemapEntries: state.getEntries }));
vi.mock("../../lib/image-sitemap", () => ({ buildProductImageSitemap: state.build }));

import { GET } from "./route";

describe("rota do image sitemap", () => {
  beforeEach(() => {
    state.getEntries.mockReset();
    state.build.mockReset();
  });

  it("serve XML do image sitemap com cache curto", async () => {
    state.getEntries.mockResolvedValue([]);
    state.build.mockReturnValue("<urlset />");

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(await response.text()).toBe("<urlset />");
  });

  it("retorna indisponibilidade sem publicar sitemap vazio quando a RPC falha", async () => {
    state.getEntries.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.build).not.toHaveBeenCalled();
  });
});
