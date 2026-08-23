export type ManagedVariant = {
  id: string;
  sku: string;
  color: string;
  size: string;
  active: boolean;
  available: number;
  reserved: number;
  sellable: number;
  colorHex?: string;
  priceInCents?: number | null;
  costInCents?: number | null;
};

export type ManagedProduct = {
  id: string;
  name: string;
  slug: string;
  status: string;
  statusReason?: string;
  priceInCents: number;
  compareAtPriceInCents?: number | null;
  stock: number;
  categoryId?: string;
  modelId?: string;
  collectionId?: string;
  shortDescription?: string;
  description?: string;
  costInCents?: number;
  featured?: boolean;
  weightGrams?: number;
  heightCm?: number;
  widthCm?: number;
  lengthCm?: number;
  seoTitle?: string;
  seoDescription?: string;
  canDelete?: boolean;
  images?: Array<{
    id: string;
    path: string;
    url: string;
    alt: string;
    primary: boolean;
    sortOrder: number;
    variantId?: string;
  }>;
  variants: ManagedVariant[];
};

export type EditableVariantColorGroup = {
  key: string;
  color: string;
  colorHex: string;
  variants: Array<{ index: number; variant: EditableVariant }>;
};

export type EditableVariant = {
  id?: string;
  sku: string;
  color: string;
  colorHex: string;
  size: string;
  priceInCents: number | null;
  costInCents: number | null;
  stock: number;
  active: boolean;
};

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;

export function isManagedProduct(value: unknown): value is ManagedProduct {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const product = value as Record<string, unknown>;
  if (
    typeof product.id !== "string" ||
    !uuidPattern.test(product.id) ||
    typeof product.name !== "string" ||
    typeof product.slug !== "string" ||
    typeof product.status !== "string" ||
    typeof product.priceInCents !== "number" ||
    !Number.isFinite(product.priceInCents) ||
    typeof product.stock !== "number" ||
    !Number.isFinite(product.stock) ||
    !Array.isArray(product.variants) ||
    (product.images !== undefined && !Array.isArray(product.images))
  ) {
    return false;
  }

  const variantsAreValid = product.variants.every((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const variant = value as Record<string, unknown>;
    return (
      typeof variant.id === "string" &&
      uuidPattern.test(variant.id) &&
      typeof variant.sku === "string" &&
      typeof variant.color === "string" &&
      typeof variant.size === "string" &&
      typeof variant.active === "boolean" &&
      typeof variant.available === "number" &&
      Number.isFinite(variant.available) &&
      typeof variant.reserved === "number" &&
      Number.isFinite(variant.reserved) &&
      typeof variant.sellable === "number" &&
      Number.isFinite(variant.sellable)
    );
  });
  if (!variantsAreValid) return false;

  return (product.images ?? []).every((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const image = value as Record<string, unknown>;
    return (
      typeof image.id === "string" &&
      uuidPattern.test(image.id) &&
      typeof image.path === "string" &&
      typeof image.url === "string" &&
      image.url.length > 0 &&
      typeof image.alt === "string" &&
      typeof image.primary === "boolean" &&
      typeof image.sortOrder === "number" &&
      Number.isFinite(image.sortOrder)
    );
  });
}

const tokens = (value: string) =>
  [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];

const skuPart = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-|-$/gu, "")
    .toLocaleUpperCase("pt-BR");

export function generateVariantCombinations(
  colors: string,
  sizes: string,
  skuPrefix: string
): EditableVariant[] {
  const prefix = skuPart(skuPrefix);
  if (!prefix) return [];
  return tokens(colors).flatMap((color) =>
    tokens(sizes).map((size) => ({
      sku: `${prefix}-${skuPart(color)}-${skuPart(size)}`,
      color,
      colorHex: "",
      size,
      priceInCents: null,
      costInCents: null,
      stock: 0,
      active: true
    }))
  );
}

export function groupEditableVariantsByColor(
  variants: EditableVariant[]
): EditableVariantColorGroup[] {
  const groups = new Map<string, EditableVariantColorGroup>();

  variants.forEach((variant, index) => {
    const normalizedColor = variant.color.trim().toLocaleLowerCase("pt-BR") || "sem-cor";
    const existing = groups.get(normalizedColor);
    if (existing) {
      existing.variants.push({ index, variant });
      if (!existing.colorHex && variant.colorHex) existing.colorHex = variant.colorHex;
      return;
    }

    groups.set(normalizedColor, {
      key: normalizedColor,
      color: variant.color.trim() || "Sem cor",
      colorHex: variant.colorHex,
      variants: [{ index, variant }]
    });
  });

  return [...groups.values()];
}

export const filterManagedProducts = (
  products: ManagedProduct[],
  filter: "all" | "out",
  query: string
) => {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  return products.filter(
    (product) =>
      (filter === "all" || product.stock <= 0) &&
      (!normalized ||
        `${product.name} ${product.variants.map((variant) => variant.sku).join(" ")}`
          .toLocaleLowerCase("pt-BR")
          .includes(normalized))
  );
};
