import { z } from "zod";

const uuid = z.string().uuid();
const optionalUuidField = uuid.or(z.literal(""));
const nullableMoney = z.number().int().min(0).max(100_000_000).nullable();

const draftFieldsSchema = z.object({
  name: z.string().max(160).optional(),
  slug: z.string().max(180).optional(),
  description: z.string().max(4_000).optional(),
  modelId: optionalUuidField.optional(),
  collectionId: optionalUuidField.optional(),
  statusReason: z.string().max(1_000).optional(),
  price: z.string().max(32).optional(),
  compareAtPrice: z.string().max(32).optional(),
  cost: z.string().max(32).optional(),
  productKind: z.enum(["simple", "variations"]).optional(),
  stockReason: z.string().max(500).optional(),
  weightGrams: z.string().max(32).optional(),
  heightCm: z.string().max(32).optional(),
  widthCm: z.string().max(32).optional(),
  lengthCm: z.string().max(32).optional(),
  shortDescription: z.string().max(280).optional(),
  featured: z.literal("on").optional()
}).strict();

const draftVariantSchema = z.object({
  id: uuid.optional(),
  sku: z.string().max(140),
  color: z.string().max(80),
  colorHex: z.string().regex(/^#[0-9a-f]{6}$/iu).or(z.literal("")).default(""),
  colorHexSecondary: z.string().regex(/^#[0-9a-f]{6}$/iu).or(z.literal("")).default(""),
  size: z.string().max(40),
  priceInCents: nullableMoney,
  costInCents: nullableMoney,
  stock: z.number().int().min(0).max(999_999),
  active: z.boolean(),
  gtin: z.string().max(50),
  mpn: z.string().max(70)
}).strict();

const draftSizeGuideSchema = z.object({
  size: z.string().max(40),
  measurementCm: z.number().positive().max(9_999.99).nullable()
}).strip();

const draftSpecificationSchema = z.object({
  label: z.string().max(80),
  value: z.string().max(500)
}).strict();

export const PRODUCT_DRAFT_SCHEMA_VERSION = 1 as const;
export const PRODUCT_DRAFT_MAX_BYTES = 64 * 1024;

export const newProductDraftSchema = z.object({
  schemaVersion: z.literal(PRODUCT_DRAFT_SCHEMA_VERSION),
  savedAt: z.string().max(40).refine((value) => Number.isFinite(Date.parse(value))),
  fields: draftFieldsSchema,
  categoryIds: z.array(uuid).max(50),
  primaryCategoryId: optionalUuidField,
  variants: z.array(draftVariantSchema).max(500),
  hasVariations: z.boolean(),
  simpleStock: z.number().int().min(0).max(999_999),
  productActive: z.boolean().default(false),
  variantColors: z.string().max(4_000).default(""),
  variantSizes: z.string().max(2_000).default(""),
  variantSkuPrefix: z.string().max(160).default(""),
  sizeGuide: z.array(draftSizeGuideSchema).max(100).default([]),
  specifications: z.array(draftSpecificationSchema).max(50).default([])
}).strict();

export type NewProductDraft = z.infer<typeof newProductDraftSchema>;

export const productDraftStorageKey = (ownerKey: string) =>
  `curtiz:product-draft:v1:${ownerKey}`;

export function parseNewProductDraft(value: unknown): NewProductDraft | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    const raw = typeof value === "string" ? JSON.parse(value) as unknown : value;
    let candidate = raw;
    if (raw && typeof raw === "object" && !Array.isArray(raw) &&
        "version" in raw && !("schemaVersion" in raw)) {
      const { version, ...legacy } = raw as Record<string, unknown>;
      candidate = { ...legacy, schemaVersion: version };
    }
    const parsed = newProductDraftSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function newestProductDraft(
  ...drafts: Array<NewProductDraft | null | undefined>
): NewProductDraft | null {
  return drafts
    .filter((draft): draft is NewProductDraft => Boolean(draft))
    .sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt))[0] ?? null;
}

export function productDraftContentFingerprint(draft: NewProductDraft): string {
  const { savedAt: _savedAt, ...content } = draft;
  return JSON.stringify(content);
}
