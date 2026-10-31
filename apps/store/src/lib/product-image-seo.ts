const genericAltText = /^(?:image|imagem|imagem do produto|foto|foto do produto|product image)$/iu;

export function productImageAlt(productName: string, savedAlt?: string, color?: string): string {
  const normalized = savedAlt?.normalize("NFKC").replace(/\p{Cc}/gu, " ").replace(/\s+/gu, " ").trim();
  if (normalized && normalized.length <= 180 && !genericAltText.test(normalized)) return normalized;

  return [productName.trim(), color?.trim(), "da curti Z"].filter(Boolean).join(" ");
}

export function isPublicProductImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const path = decodeURIComponent(url.pathname).toLocaleLowerCase("en-US");
    if (!/(?:^|\/)products\//u.test(path)) return false;
    if (/(?:^|\/)(?:banners?|campaigns?|cms|logos?|icons?|placeholders?|categories|homepage-public)(?:\/|$)/u.test(path)) return false;
    if (/hero-curtiz|\/optimized\/hero-|placeholder|(?:^|\/)thumb(?:nail)?s?\//u.test(path)) return false;
    return /\.(?:avif|jpe?g|png|webp)$/u.test(path);
  } catch {
    return false;
  }
}

export function publicProductImageUrl(path: string): string {
  const normalized = path.replace(/^catalog-public\//u, "");
  if (!/^products\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:avif|jpe?g|png|webp)$/iu.test(normalized)) return "";
  const origin = process.env.SUPABASE_URL?.trim();
  if (!origin) return "";
  try {
    const base = new URL(origin);
    const localHttp = base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)
      && process.env.APP_ENV !== "production";
    if ((base.protocol !== "https:" && !localHttp) || base.pathname !== "/" || base.search || base.hash || base.username || base.password) return "";
    const url = `${base.origin}/storage/v1/object/public/catalog-public/${normalized.split("/").map(encodeURIComponent).join("/")}`;
    return localHttp || isPublicProductImageUrl(url) ? url : "";
  } catch {
    return "";
  }
}
