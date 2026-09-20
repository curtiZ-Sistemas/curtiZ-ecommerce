const validHexColor = /^#[0-9a-f]{6}$/iu;

export const normalizeProductColorName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");

export const normalizeProductColorHex = (value?: string | null) => {
  const normalized = value?.trim() ?? "";
  return validHexColor.test(normalized) ? normalized.toUpperCase() : "";
};

export function productColorSwatchBackground(primaryColor: string, secondaryColor?: string | null) {
  const primary = normalizeProductColorHex(primaryColor) || "#9B9B9B";
  const secondary = normalizeProductColorHex(secondaryColor);
  return secondary
    ? `linear-gradient(to right, ${primary} 0 50%, ${secondary} 50% 100%)`
    : primary;
}
