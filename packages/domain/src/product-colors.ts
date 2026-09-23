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

export function productColorSwatchColors(primaryColor: string, secondaryColor?: string | null) {
  const primary = normalizeProductColorHex(primaryColor) || "#9B9B9B";
  const normalizedSecondary = normalizeProductColorHex(secondaryColor);
  const secondary = normalizedSecondary && normalizedSecondary !== primary ? normalizedSecondary : undefined;
  return { primary, secondary };
}
