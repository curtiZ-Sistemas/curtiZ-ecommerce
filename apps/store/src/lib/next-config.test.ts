import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("headers de imagens de hero", () => {
  it("applies recovery no-referrer overrides after the general policy", async () => {
    const routes = await nextConfig.headers?.() ?? [];
    const generalIndex = routes.findIndex((route) => route.source === "/(.*)");
    for (const source of ["/auth/recovery", "/api/auth/recovery/verify", "/api/auth/password"]) {
      const index = routes.findIndex((route) => route.source === source);
      expect(index).toBeGreaterThan(generalIndex);
      expect(routes[index]?.headers).toContainEqual({ key: "Referrer-Policy", value: "no-referrer" });
    }
  });

  it("preserva URLs comerciais antigas com redirecionamento permanente ao catálogo atual", async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects).toContainEqual({ source: "/slides", destination: "/produtos", permanent: true });
    expect(redirects).toContainEqual({ source: "/sandalias", destination: "/produtos", permanent: true });
  });
  it("protege somente os recursos conhecidos de hero e suas variantes locais", async () => {
    const routes = await nextConfig.headers?.();
    const protectedSources = routes
      ?.filter((route) => route.headers.some((header) => header.key.toLowerCase() === "x-robots-tag"))
      .map((route) => route.source);

    expect(protectedSources).toContain("/images/hero-curtiz-desktop.webp");
    expect(protectedSources).toContain("/images/hero-curtiz-mobile.avif");
    expect(protectedSources).toContain("/images/optimized/hero-mobile.430.avif");
    expect(protectedSources).not.toContain("/images/products/:path*");
    expect(routes?.find((route) => route.source === "/images/hero-curtiz-desktop.webp")?.headers)
      .toContainEqual({ key: "X-Robots-Tag", value: "noindex, noimageindex" });

    const workerAssetHeaders = await readFile(path.resolve(process.cwd(), "public/_headers"), "utf8");
    expect(workerAssetHeaders).toContain("/images/hero-curtiz-desktop.webp\n  X-Robots-Tag: noindex, noimageindex");
    expect(workerAssetHeaders).toContain("/images/*\n  Cache-Control: public, max-age=31536000, immutable");
    expect(workerAssetHeaders).not.toMatch(/\/images\/\*\s+X-Robots-Tag/iu);
  });
});
