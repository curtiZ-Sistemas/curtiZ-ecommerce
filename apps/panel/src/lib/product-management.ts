export function productDeletionMessage(blockers: readonly string[] = []): string {
  const labels: Record<string, string> = {
    "cart items": "itens em carrinhos",
    "marketing events": "eventos de marketing",
    "inventory reservations": "reservas de estoque",
    "coupon scopes": "cupons vinculados",
    "product questions": "perguntas de clientes",
    "inventory count items": "contagens de estoque"
  };
  return blockers.length
    ? `Não é possível excluir: ${blockers.map((blocker) => labels[blocker] ?? blocker).join(", ")}. Use Arquivar para preservar os vínculos.`
    : "Não foi possível confirmar se o produto pode ser excluído. Atualize a listagem.";
}

export type NewProductDraft = {
  version: 1;
  savedAt: string;
  fields: Record<string, string>;
  categoryIds: string[];
  primaryCategoryId: string;
  variants: EditableVariant[];
  hasVariations: boolean;
  simpleStock: number;
  variantColors: string;
  variantSizes: string;
  variantSkuPrefix: string;
};

export const productDraftStorageKey = (ownerKey: string) =>
  `curtiz:product-draft:v1:${ownerKey}`;

export function parseNewProductDraft(value: string | null): NewProductDraft | null {
  if (!value) return null;
  try {
    const draft: unknown = JSON.parse(value);
    if (!draft || typeof draft !== "object") return null;
    const candidate = draft as Partial<NewProductDraft>;
    if (
      candidate.version !== 1 ||
      !candidate.fields || typeof candidate.fields !== "object" ||
      !Array.isArray(candidate.categoryIds) ||
      !Array.isArray(candidate.variants) ||
      typeof candidate.primaryCategoryId !== "string" ||
      typeof candidate.hasVariations !== "boolean" ||
      typeof candidate.simpleStock !== "number"
    ) return null;
    return candidate as NewProductDraft;
  } catch {
    return null;
  }
}

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
  gtin?: string;
  mpn?: string;
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
  categoryIds?: string[];
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
  categoryName?: string;
  categoryNames?: string[];
  deleteBlockers?: string[];
  merchantCondition?: "new" | "refurbished" | "used";
  merchantGender?: "male" | "female" | "unisex";
  merchantAgeGroup?: "newborn" | "infant" | "toddler" | "kids" | "adult";
  googleProductCategory?: string;
  merchantIdentifierExists?: boolean | null;
  merchantEligibility?: {
    eligible: boolean;
    eligibleVariants: number;
    activeVariants: number;
    reasons: string[];
    warnings: string[];
  };
  canDelete?: boolean;
  images?: Array<{
    id: string;
    path: string;
    url: string;
    alt: string;
    primary: boolean;
    sortOrder: number;
    width: number;
    height: number;
    variantId?: string;
  }>;
  media?: ManagedProductMedia[];
  variants: ManagedVariant[];
};

export type ManagedProductMedia = {
  id: string;
  path: string;
  url: string;
  alt: string;
  primary: boolean;
  sortOrder: number;
  type: "image" | "video";
  mimeType: string;
  variantId?: string;
  posterPath?: string;
  posterUrl?: string;
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
  gtin: string;
  mpn: string;
};

export type ProductPublicationInput = {
  name?: string;
  categoryIds?: string[];
  priceInCents?: number | null;
  variants?: Array<{ active: boolean }>;
};

export const MAX_PRODUCT_MEDIA_SIZE = 10 * 1024 * 1024;
export const MAX_PRODUCT_VIDEO_SIZE = 80 * 1024 * 1024;
export const PRODUCT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const PRODUCT_VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
export const PRODUCT_MEDIA_TYPES = new Set([...PRODUCT_IMAGE_TYPES, ...PRODUCT_VIDEO_TYPES]);

export function partitionProductMediaFiles<T extends { name: string; size: number; type: string }>(
  files: readonly T[]
) {
  const accepted: T[] = [];
  const rejected: T[] = [];

  files.forEach((file) => {
    if (
      file.size > 0 &&
      file.size <= (PRODUCT_VIDEO_TYPES.has(file.type) ? MAX_PRODUCT_VIDEO_SIZE : MAX_PRODUCT_MEDIA_SIZE) &&
      PRODUCT_MEDIA_TYPES.has(file.type) &&
      (PRODUCT_VIDEO_TYPES.has(file.type)
        ? /\.(?:mp4|webm)$/iu.test(file.name)
        : /\.(?:jpe?g|png|webp)$/iu.test(file.name))
    ) {
      accepted.push(file);
    } else {
      rejected.push(file);
    }
  });

  return { accepted, rejected };
}

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
    (product.images !== undefined && !Array.isArray(product.images)) ||
    (product.media !== undefined && !Array.isArray(product.media))
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

  const imagesAreValid = (product.images ?? []).every((value) => {
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
  if (!imagesAreValid) return false;

  return (product.media ?? []).every((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const media = value as Record<string, unknown>;
    return (
      typeof media.id === "string" &&
      uuidPattern.test(media.id) &&
      typeof media.path === "string" &&
      typeof media.url === "string" &&
      typeof media.alt === "string" &&
      (media.type === "image" || media.type === "video") &&
      typeof media.mimeType === "string" &&
      typeof media.primary === "boolean" &&
      typeof media.sortOrder === "number" &&
      Number.isFinite(media.sortOrder) &&
      (media.type !== "video" || typeof media.posterUrl === "string")
    );
  });
}

const tokens = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  )
];

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
      active: true,
      gtin: "",
      mpn: ""
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

export function productPublishRequirements(product: {
  name?: string;
  categoryIds?: string[];
  priceInCents?: number | null;
  variants?: Array<{ active: boolean }>;
}): string[] {
  const missing: string[] = [];
  if (!product.name?.trim()) missing.push("nome");
  if (!product.categoryIds?.length) missing.push("categoria");
  if (!product.priceInCents || product.priceInCents <= 0) missing.push("preço de venda");
  if (!product.variants?.some((variant) => variant.active)) missing.push("estoque do produto");
  return missing;
}

export function productPublicationMessage(product: ProductPublicationInput): string | null {
  if (!product.name?.trim()) return "Adicione o nome do produto.";
  if (!product.categoryIds?.length) return "Escolha a categoria do produto.";
  if (!product.priceInCents || product.priceInCents <= 0) {
    return "Adicione o preço do produto.";
  }
  if (!product.variants?.some((variant) => variant.active)) {
    return "Adicione o estoque do produto.";
  }
  return null;
}

export function automaticProductSeo(input: {
  name: string;
  description?: string;
  categoryName?: string;
}) {
  const name = input.name.trim();
  const category = input.categoryName?.trim();
  const source = input.description?.trim() ||
    `${name}${category ? ` na categoria ${category}` : ""}. Compre online na curtiZ.`;
  const title = `${name}${category ? ` | ${category}` : ""} | curtiZ`;
  return {
    title: title.slice(0, 160),
    description: source.replace(/\s+/gu, " ").slice(0, 320)
  };
}

export function productThumbnail(product: Pick<ManagedProduct, "images">) {
  return product.images?.find((image) => image.primary) ?? product.images?.[0] ?? null;
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
