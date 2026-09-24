const storagePrefix = "/storage/v1/object/public/catalog-public/";
const safePathSegment = /^[a-z0-9][a-z0-9._-]{0,199}$/iu;
const allowedBannerExtension = /\.(?:avif|jpe?g|png|webp)$/iu;

export function isSafeBannerStoragePath(path: string): boolean {
  const segments = path.split("/");
  if (path.length > 500 || segments.length < 3 || segments.length > 8 || segments[0] !== "banners") return false;
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("..") || !safePathSegment.test(segment))) {
    return false;
  }
  return allowedBannerExtension.test(segments.at(-1) ?? "");
}

export function bannerProxyUrl(reference: string, configuredSupabaseUrl?: string): string {
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
  storagePath = storagePath.replace(/^catalog-public\//u, "");
  if (!isSafeBannerStoragePath(storagePath)) return "";
  return `/media/banner/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
}
