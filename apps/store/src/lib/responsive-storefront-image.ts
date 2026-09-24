const categoryStoragePathPattern = /^categories\/(?:[a-z0-9][a-z0-9._-]{0,199}\/){0,6}[a-z0-9][a-z0-9._-]{0,199}\.(?:avif|jpe?g|png|webp)$/iu;

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
