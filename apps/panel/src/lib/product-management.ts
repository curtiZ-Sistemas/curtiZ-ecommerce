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
