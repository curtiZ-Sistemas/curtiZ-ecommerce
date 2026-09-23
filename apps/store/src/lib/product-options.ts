export type ProductOptionVariant = {
  id?: string;
  color: string;
  colorHex?: string;
  colorHexSecondary?: string;
  size: string;
  stock: number;
};

const fallbackColors: Readonly<Record<string, string>> = {
  branco: "#ffffff",
  preto: "#171717",
  marinho: "#1e2a44",
  azul: "#285f9e",
  bege: "#cbb89d",
  areia: "#d8c5a8",
  rosa: "#df7d94",
  coral: "#df6f61",
  vermelho: "#a7261d",
  verde: "#47785d",
  cinza: "#777777"
};

const normalizedColorName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .trim()
    .toLowerCase();

export function resolveProductColor(color: string, colorHex?: string): string {
  const normalizedHex = colorHex?.trim();
  if (normalizedHex && /^#[\da-f]{6}$/iu.test(normalizedHex)) return normalizedHex;
  return fallbackColors[normalizedColorName(color)] ?? "#9b9b9b";
}

export function initialProductSelection(
  variants: readonly ProductOptionVariant[],
  preferredVariantId?: string
) {
  const preferred = preferredVariantId
    ? variants.find((variant) => variant.id === preferredVariantId)
    : undefined;
  if (preferred) return { color: preferred.color, size: preferred.size };
  const firstAvailable = variants.find((variant) => variant.stock > 0) ?? variants[0];
  if (!firstAvailable) return { color: "", size: "" };
  const availableSizes = [
    ...new Set(
      variants
        .filter((variant) => variant.color === firstAvailable.color && variant.stock > 0)
        .map((variant) => variant.size)
    )
  ];
  return {
    color: firstAvailable.color,
    size: availableSizes.length === 1 ? availableSizes[0] ?? "" : ""
  };
}

export function galleryWindowStart(imageCount: number, requestedStart: number): number {
  return Math.max(0, Math.min(requestedStart, Math.max(0, imageCount - 3)));
}

export type ColorMedia = { src: string; variantId?: string; color?: string };

export function mediaForColor<T extends ColorMedia>(
  media: readonly T[], color: string, variantId?: string, colorImage?: T
): T[] {
  const matching = media.filter((item) => item.color === color || (variantId !== undefined && item.variantId === variantId));
  const generic = media.filter((item) => !item.color && !item.variantId);
  return [...matching, ...(colorImage ? [colorImage] : []), ...generic].filter(
    (item, index, list) => list.findIndex((candidate) => candidate.src === item.src) === index
  );
}

export function preferredColorImage(
  media: readonly ColorMedia[], color: string, variantId: string | undefined,
  variantImage: string | undefined, fallback: string
) {
  return media.find((item) => item.color === color || (variantId !== undefined && item.variantId === variantId))?.src
    ?? variantImage
    ?? media.find((item) => !item.color && !item.variantId)?.src
    ?? fallback;
}
