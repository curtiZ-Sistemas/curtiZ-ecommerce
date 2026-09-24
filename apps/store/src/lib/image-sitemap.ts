import { officialUrl } from "./seo";
import type { SitemapProductImageEntry } from "./seo-data";
import { isPublicProductImageUrl } from "./product-image-seo";

const xmlEscape = (value: string) =>
  value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;").replace(/'/gu, "&apos;");

export function buildProductImageSitemap(entries: SitemapProductImageEntry[]): string {
  const urls = entries.flatMap((entry) => {
    const images = [...new Set(entry.images.map((image) => image.url).filter(isPublicProductImageUrl))];
    if (!entry.slug || !images.length) return [];
    const lastModified = entry.updatedAt && Number.isFinite(Date.parse(entry.updatedAt))
      ? `<lastmod>${xmlEscape(new Date(entry.updatedAt).toISOString())}</lastmod>`
      : "";
    const emittedImages = new Set<string>();
    const imageNodes = entry.images
      .filter((image) => images.includes(image.url) && !emittedImages.has(image.url) && Boolean(emittedImages.add(image.url)))
      .map((image) => `<image:image><image:loc>${xmlEscape(image.url)}</image:loc>${image.alt ? `<image:title>${xmlEscape(image.alt)}</image:title>` : ""}</image:image>`)
      .join("");
    return [`<url><loc>${xmlEscape(officialUrl(`/produto/${encodeURIComponent(entry.slug)}`))}</loc>${lastModified}${imageNodes}</url>`];
  });

  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls.join("")}</urlset>`;
}
