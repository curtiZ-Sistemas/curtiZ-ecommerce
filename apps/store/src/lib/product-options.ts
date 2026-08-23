export type ProductOptionVariant = {
  color: string;
  colorHex?: string;
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

export function initialProductSelection(variants: readonly ProductOptionVariant[]) {
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
