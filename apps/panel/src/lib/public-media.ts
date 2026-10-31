import { safeInternalPath } from "@curtiz/security/safe-path";

type PublicMediaOptions = {
  storeUrl?: string;
  supabaseUrl?: string;
};

export function panelMediaUrl(path: string, bucket = "catalog-public", storeUrl?: string): string {
  if (!path) return "";
  if (path.startsWith("/") && !path.startsWith("//")) {
    if (!safeInternalPath(path, "")) return "";
    return storeUrl ? new URL(path, storeUrl).toString() : path;
  }
  return `/api/media?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
}

export function publicCatalogUploadSource(supabaseUrl?: string): string | null {
  const origin = safeOrigin(supabaseUrl);
  return origin ? `${origin}/storage/v1/object/upload/sign/catalog-public/products/` : null;
}

function safeOrigin(value?: string): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function publicCatalogMediaOrigins(options: PublicMediaOptions): string[] {
  return [...new Set([
    safeOrigin(options.storeUrl),
    safeOrigin(options.supabaseUrl)
  ].filter((origin): origin is string => Boolean(origin)))];
}

export function publicCatalogMediaUrl(
  path: string,
  { storeUrl, supabaseUrl }: PublicMediaOptions
): string {
  if (!path) return "";
  if (path.startsWith("https://")) {
    try {
      const url = new URL(path);
      return !url.username && !url.password && publicCatalogMediaOrigins({ storeUrl, supabaseUrl }).includes(url.origin)
        ? path
        : "";
    } catch {
      return "";
    }
  }

  if (path.startsWith("/")) {
    if (!safeInternalPath(path, "")) return "";
    if (!storeUrl) return path;
    try {
      return new URL(path, storeUrl).toString();
    } catch {
      return path;
    }
  }

  if (!supabaseUrl) return "";
  return `${supabaseUrl.replace(/\/$/u, "")}/storage/v1/object/public/catalog-public/${path.replace(/^catalog-public\//u, "")}`;
}
