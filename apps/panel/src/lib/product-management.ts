export type ManagedVariant = {
  id: string;
  sku: string;
  color: string;
  size: string;
  active: boolean;
  available: number;
  reserved: number;
  sellable: number;
};

export type ManagedProduct = {
  id: string;
  name: string;
  slug: string;
  status: string;
  priceInCents: number;
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
  variants: ManagedVariant[];
};

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

export const nextAvailableQuantity = (current: number, added: number) => current + added;
