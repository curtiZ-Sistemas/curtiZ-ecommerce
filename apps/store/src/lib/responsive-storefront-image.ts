import optimizedCatalogImages from "./optimized-catalog-images.json";
const bundledProductPattern = /^\/images\/products\/([a-z0-9-]+)\.webp$/u;

export function bundledProductSrcSet(source: string) {
  const optimized = (optimizedCatalogImages as Record<string, string>)[source];
  if (optimized) return `${optimized}.360.webp 360w, ${optimized}.540.webp 540w, ${optimized}.720.webp 720w`;
  const match = source.match(bundledProductPattern);
  if (!match) return null;
  const base = `/images/products/${match[1]}`;
  return `${base}.360.webp 360w, ${base}.540.webp 540w, ${base}.webp 720w`;
}
