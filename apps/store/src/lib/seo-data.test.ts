import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("./supabase/server", () => ({
  createPublicSupabaseClient: () => ({ rpc })
}));

import { getActiveProductSitemapEntries } from "./seo-data";

describe("fonte de produtos do sitemap", () => {
  beforeEach(() => rpc.mockReset());

  it("usa a projeção comercial do banco e preserva updated_at real", async () => {
    rpc.mockResolvedValue({
      data: [
        { slug: "slide-ativo", updatedAt: "2026-09-12T10:00:00.000Z" },
        { slug: "sandalia-ativa", updatedAt: "2026-09-12T11:00:00.000Z" }
      ],
      error: null
    });

    await expect(getActiveProductSitemapEntries()).resolves.toEqual([
      { slug: "slide-ativo", updatedAt: "2026-09-12T10:00:00.000Z" },
      { slug: "sandalia-ativa", updatedAt: "2026-09-12T11:00:00.000Z" }
    ]);
    expect(rpc).toHaveBeenCalledWith("get_storefront_product_seo_entries", { p_limit: 50_000 });
  });

  it("não publica fallback hardcoded quando o banco falha", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "database_unavailable" } });
    await expect(getActiveProductSitemapEntries()).resolves.toEqual([]);
  });
});
