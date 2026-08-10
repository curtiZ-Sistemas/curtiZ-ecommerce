type PublicMediaOptions = {
  storeUrl?: string;
  supabaseUrl?: string;
};

export function publicCatalogMediaUrl(
  path: string,
  { storeUrl, supabaseUrl }: PublicMediaOptions
): string {
  if (!path) return "";
  if (path.startsWith("https://")) return path;

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
