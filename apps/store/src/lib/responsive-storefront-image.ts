const bundledProductPattern = /^\/images\/products\/([a-z0-9-]+)\.webp$/u;

export function bundledProductSrcSet(source: string) {
  const match = source.match(bundledProductPattern);
  if (!match) return null;
  const base = `/images/products/${match[1]}`;
  return `${base}.360.webp 360w, ${base}.540.webp 540w, ${base}.webp 720w`;
}
