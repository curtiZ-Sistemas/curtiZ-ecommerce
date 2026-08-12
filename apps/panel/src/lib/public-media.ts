type PublicMediaOptions = {
  storeUrl?: string;
  supabaseUrl?: string;
};

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
      return publicCatalogMediaOrigins({ storeUrl, supabaseUrl }).includes(new URL(path).origin)
        ? path
        : "";
    } catch {
      return "";
    }
  }

  if (path.startsWith("/")) {
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
