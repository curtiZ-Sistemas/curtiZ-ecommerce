import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { cachePublicStorefrontData } from "./public-storefront-cache";

function createCache() {
  const values = new Map<string, Response>();
  const match = vi.fn(async (request: Request) => values.get(request.url)?.clone() ?? null);
  const put = vi.fn(async (request: Request, response: Response) => {
    values.set(request.url, response.clone());
  });
  return { match, put };
}

describe("cachePublicStorefrontData", () => {
  it("reuses public data across requests with the configured TTL", async () => {
    const cache = createCache();
    const load = vi.fn(async () => ({ title: "Coleção" }));
    const options = { key: "homepage-v1", ttlSeconds: 30 as const, cache, load };

    const first = await cachePublicStorefrontData(options);
    const second = await cachePublicStorefrontData({
      ...options,
      load: vi.fn(async () => ({ title: "Atualizado" }))
    });

    expect(first).toEqual({ title: "Coleção" });
    expect(second).toEqual(first);
    expect(load).toHaveBeenCalledOnce();
    expect(cache.put).toHaveBeenCalledOnce();
    expect(cache.put.mock.calls[0]?.[1].headers.get("cache-control")).toBe("public, max-age=30");
  });

  it("falls back to the public source if the edge cache is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const load = vi.fn(async () => ["dados públicos"]);
    const cache = {
      match: vi.fn(async () => { throw new Error("cache indisponível"); }),
      put: vi.fn(async () => undefined)
    };

    await expect(cachePublicStorefrontData({
      key: "navigation-v1",
      ttlSeconds: 60,
      cache,
      load
    })).resolves.toEqual(["dados públicos"]);
    expect(load).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
