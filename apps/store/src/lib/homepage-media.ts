const storagePrefix = "/storage/v1/object/public/homepage-public/";
const imageDirectories = new Set([
  "home-sections",
  "home-section-images",
  "home-section-mobile-images",
  "home-section-thumbnails"
]);
const safePathSegment = /^[a-z0-9][a-z0-9._-]{0,199}$/iu;

export function isSafeHomepageImagePath(path: string): boolean {
  const segments = path.split("/");
  return path.length <= 500 && segments.length >= 3 && segments.length <= 8 &&
    imageDirectories.has(segments[0] ?? "") &&
    segments.every((segment) => segment && segment !== "." && segment !== ".." && !segment.includes("..") && safePathSegment.test(segment)) &&
    /\.(?:jpe?g|png|webp)$/iu.test(segments.at(-1) ?? "");
}

export function homepageImageProxyUrl(reference: string, configuredSupabaseUrl?: string): string {
  let storagePath = reference;
  if (reference.startsWith("https://")) {
    try {
      const source = new URL(reference);
      const configuredOrigin = configuredSupabaseUrl ? new URL(configuredSupabaseUrl).origin : "";
      if (source.origin !== configuredOrigin || !source.pathname.startsWith(storagePrefix)) return "";
      storagePath = decodeURIComponent(source.pathname.slice(storagePrefix.length));
    } catch {
      return "";
    }
  }
  storagePath = storagePath.replace(/^homepage-public\//u, "");
  if (!isSafeHomepageImagePath(storagePath)) return "";
  return `/media/homepage/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
}
