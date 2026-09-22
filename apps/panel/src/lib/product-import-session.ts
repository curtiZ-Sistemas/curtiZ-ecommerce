import "server-only";

import { z } from "zod";
import type { ProductImportSessionPayload } from "./product-import";

const PRODUCT_IMPORT_SCHEMA = "curtiz_import_v1";
const PRODUCT_IMPORT_MAX_PRODUCTS = 100;
const PRODUCT_IMPORT_MAX_VARIANTS = 2_000;
const PRODUCT_IMPORT_MAX_IMAGES = 1_000;

export const SHOPEE_IMAGE_HOSTS = new Set(["down-sg.img.susercontent.com"]);

export function productImportTaxonomySlug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 180);
}

export function isAllowedShopeeImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && SHOPEE_IMAGE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

const nullableMoney = z.number().int().min(0).max(2_000_000_000).nullable();
const nullableMeasure = z.number().positive().max(1_000_000).nullable();
const issueSchema = z.object({
  level: z.enum(["warning", "error"]), code: z.string().min(1).max(80),
  message: z.string().min(1).max(1_000), productKey: z.string().max(120).optional()
}).strict();
const variantSchema = z.object({
  variationKey: z.string().max(160), color: z.string().min(1).max(80),
  colorHex: z.string().regex(/^#[0-9A-F]{6}$/u), colorHexSecondary: z.union([z.literal(""), z.string().regex(/^#[0-9A-F]{6}$/u)]),
  size: z.string().min(1).max(40), sku: z.string().min(2).max(140), active: z.boolean(),
  stock: z.number().int().min(0).max(10_000_000), priceInCents: nullableMoney, costInCents: nullableMoney,
  gtin: z.string().max(50), mpn: z.string().max(70)
}).strict();
const imageSchema = z.object({
  url: z.string().max(2_048).refine(isAllowedShopeeImageUrl), color: z.string().max(80),
  order: z.number().int().min(0).max(10_000), primary: z.boolean(), applyAllSizes: z.boolean()
}).strict();
const productSchema = z.object({
  key: z.string().min(1).max(120), shopeeId: z.string().max(120), source: z.string().regex(/^[a-z0-9_-]{2,40}$/u),
  name: z.string().min(3).max(160), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(180),
  categoryName: z.string().min(1).max(120), modelName: z.string().max(120), collectionName: z.string().max(120),
  shortDescription: z.string().max(280), description: z.string().max(4_000), featured: z.boolean(),
  priceInCents: nullableMoney, compareAtPriceInCents: nullableMoney, costInCents: nullableMoney,
  weightGrams: z.number().int().positive().max(10_000_000).nullable(), heightCm: nullableMeasure,
  widthCm: nullableMeasure, lengthCm: nullableMeasure,
  merchantCondition: z.enum(["new", "refurbished", "used"]).nullable(),
  merchantGender: z.enum(["male", "female", "unisex"]).nullable(),
  merchantAgeGroup: z.enum(["newborn", "infant", "toddler", "kids", "adult"]).nullable(),
  googleProductCategory: z.string().max(500), merchantIdentifierExists: z.boolean().nullable(),
  variants: z.array(variantSchema).min(1).max(PRODUCT_IMPORT_MAX_VARIANTS),
  images: z.array(imageSchema).max(PRODUCT_IMPORT_MAX_IMAGES),
  sizeGuide: z.array(z.object({ size: z.string().min(1).max(40), measurementCm: z.number().positive().max(1_000_000) }).strict()).max(1_000),
  specifications: z.array(z.object({ label: z.string().min(1).max(80), value: z.string().min(1).max(500) }).strict()).max(50),
  issues: z.array(issueSchema).max(500)
}).strict();
const postgresUuid = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu);
const sessionPayloadSchema = z.object({
  batch: z.object({
    schemaVersion: z.literal(PRODUCT_IMPORT_SCHEMA), products: z.array(productSchema).min(1).max(PRODUCT_IMPORT_MAX_PRODUCTS),
    colorCount: z.number().int().min(0).max(500), imageCount: z.number().int().min(0).max(PRODUCT_IMPORT_MAX_IMAGES),
    options: z.object({
      createCategoryIfMissing: z.boolean(), createModelIfMissing: z.boolean(),
      associateColorImagesToAllSizes: z.boolean(), deduplicateImageDownloadsByUrl: z.boolean()
    }).strict(),
    issues: z.array(issueSchema).max(500)
  }).strict(),
  references: z.record(z.string().min(1).max(120), z.object({
    categoryId: postgresUuid.nullable(), modelId: postgresUuid.nullable(), collectionId: postgresUuid.nullable()
  }).strict())
}).strict();

export function parseProductImportSessionPayload(value: unknown): ProductImportSessionPayload {
  const parsed = sessionPayloadSchema.safeParse(value);
  if (!parsed.success) throw new Error("A sessão de importação contém dados inválidos.");
  const variationCount = parsed.data.batch.products.reduce((total, product) => total + product.variants.length, 0);
  const imageCount = parsed.data.batch.products.reduce((total, product) => total + product.images.length, 0);
  if (variationCount > PRODUCT_IMPORT_MAX_VARIANTS || imageCount > PRODUCT_IMPORT_MAX_IMAGES ||
      parsed.data.batch.products.some((product) => !(product.key in parsed.data.references))) {
    throw new Error("A sessão de importação excede os limites permitidos.");
  }
  return parsed.data;
}
