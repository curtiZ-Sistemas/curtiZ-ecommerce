import optimizedCatalogImages from "./optimized-catalog-images.json";
const bundledProductPattern = /^\/images\/products\/([a-z0-9-]+)\.webp$/u;
const storagePathPattern = /^products\/(?:[a-z0-9][a-z0-9._-]{0,199}\/){1,7}[a-z0-9][a-z0-9._-]{0,199}\.(?:avif|jpe?g|png|webp)$/iu;
const categoryStoragePathPattern = /^categories\/(?:[a-z0-9][a-z0-9._-]{0,199}\/){0,6}[a-z0-9][a-z0-9._-]{0,199}\.(?:avif|jpe?g|png|webp)$/iu;

function productImagePath(source: string) {
  try {
    const url = new URL(source);
    const prefix = "/storage/v1/object/public/catalog-public/";
    if (url.protocol !== "https:" || url.username || url.password || !url.pathname.includes(prefix)) return null;
    const encodedPath = url.pathname.slice(url.pathname.indexOf(prefix) + prefix.length);
    const path = decodeURIComponent(encodedPath);
    return storagePathPattern.test(path) && !path.split("/").some((segment) => segment.includes(".."))
      ? path
      : null;
  } catch {
    return null;
  }
}

export function bundledProductSrcSet(source: string) {
  const optimized = (optimizedCatalogImages as Record<string, string>)[source];
  if (optimized) return `${optimized}.360.webp 360w, ${optimized}.540.webp 540w, ${optimized}.720.webp 720w`;
  const match = source.match(bundledProductPattern);
  if (match) {
    const base = `/images/products/${match[1]}`;
    return `${base}.360.webp 360w, ${base}.540.webp 540w, ${base}.webp 720w`;
  }
  const path = productImagePath(source);
  if (!path) return null;
  const endpoint = `/media/product/${path.split("/").map(encodeURIComponent).join("/")}`;
  return [180, 360, 540, 720, 1080]
    .map((width) => `${endpoint}?w=${width} ${width}w`)
    .join(", ");
}

export function productImageVariantUrl(source: string, width: number): string | null {
  const path = productImagePath(source);
  if (!path || ![180, 360, 540, 720, 1080].includes(width)) return null;
  return `/media/product/${path.split("/").map(encodeURIComponent).join("/")}?w=${width}`;
}

export function categoryImageSrcSet(source: string) {
  try {
    const url = new URL(source);
    const prefix = "/storage/v1/object/public/catalog-public/";
    if (url.protocol !== "https:" || url.username || url.password || !url.pathname.includes(prefix)) return null;
    const path = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(prefix) + prefix.length));
    if (!categoryStoragePathPattern.test(path) || path.split("/").some((segment) => segment.includes(".."))) return null;
    const endpoint = `/media/category/${path.split("/").map(encodeURIComponent).join("/")}`;
    return [180, 360, 540].map((width) => `${endpoint}?w=${width} ${width}w`).join(", ");
  } catch {
    return null;
  }
}
