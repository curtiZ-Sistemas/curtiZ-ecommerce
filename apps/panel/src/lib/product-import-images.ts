import type { ProductImportImage } from "./product-import";

export type PreparedProductImportImage = ProductImportImage & {
  normalizedUrl: string;
};

export type PreparedProductImportImages = {
  images: PreparedProductImportImage[];
  warnings: string[];
};

export function normalizeProductImportImageUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLocaleLowerCase("en-US");
  url.searchParams.sort();
  return url.toString();
}

export function prepareProductImportImages(source: readonly ProductImportImage[]): PreparedProductImportImages {
  const grouped = new Map<string, {
    image: PreparedProductImportImage;
    colors: Map<string, string>;
  }>();
  for (const current of source) {
    const normalizedUrl = normalizeProductImportImageUrl(current.url);
    const colorKey = current.color.trim().toLocaleLowerCase("pt-BR");
    const existing = grouped.get(normalizedUrl);
    if (!existing) {
      const colors = new Map<string, string>();
      if (colorKey) colors.set(colorKey, current.color.trim());
      grouped.set(normalizedUrl, {
        image: { ...current, url: normalizedUrl, normalizedUrl },
        colors
      });
      continue;
    }
    if (colorKey && !existing.colors.has(colorKey)) existing.colors.set(colorKey, current.color.trim());
    existing.image.primary ||= current.primary;
    existing.image.applyAllSizes ||= current.applyAllSizes;
    existing.image.order = Math.min(existing.image.order, current.order);
  }

  const warnings: string[] = [];
  const images = [...grouped.values()].map(({ image, colors }) => {
    if (colors.size > 1) {
      warnings.push("Uma URL de imagem repetida estava associada a cores diferentes e foi mantida como imagem geral do produto.");
      return { ...image, color: "", applyAllSizes: false };
    }
    const color = colors.values().next().value;
    return { ...image, color: color ?? "" };
  });
  return { images, warnings };
}
