import {
  evaluateMerchantEligibility,
  merchantFeedXml,
  type MerchantAgeGroup,
  type MerchantCatalogItem,
  type MerchantCondition,
  type MerchantGender
} from "@curtiz/domain";
import { publicCatalogImage } from "./catalog-result";
import { isUnknownRecord, readNumber, readRows, readString } from "./unknown-data";

const STORE_ORIGIN = "https://curtiz.com.br";

export type MerchantFeedResult = {
  xml: string;
  eligible: number;
  rejected: number;
  rejectionCounts: Record<string, number>;
};

const condition = (value: string): MerchantCondition | undefined =>
  value === "new" || value === "refurbished" || value === "used" ? value : undefined;
const gender = (value: string): MerchantGender | undefined =>
  value === "male" || value === "female" || value === "unisex" ? value : undefined;
const ageGroup = (value: string): MerchantAgeGroup | undefined =>
  value === "newborn" || value === "infant" || value === "toddler" || value === "kids" || value === "adult"
    ? value
    : undefined;

function merchantItem(value: unknown): MerchantCatalogItem | null {
  if (!isUnknownRecord(value)) return null;
  const variantId = readString(value, "variant_id");
  const productId = readString(value, "product_id");
  const slug = readString(value, "slug");
  const name = readString(value, "product_name");
  const color = readString(value, "color");
  const size = readString(value, "size");
  const effectivePrice = Math.round(readNumber(value, "effective_price_cents"));
  const originalPrice = Math.round(readNumber(value, "original_price_cents"));
  if (!variantId || !productId || !slug) return null;

  const path = `/produto/${encodeURIComponent(slug)}`;
  const images = readRows(value.images).flatMap((image) => {
    const url = publicCatalogImage(readString(image, "path"));
    const width = Math.round(readNumber(image, "width"));
    const height = Math.round(readNumber(image, "height"));
    return url ? [{ url, width, height }] : [];
  });
  const identifierValue = value.merchant_identifier_exists;

  return {
    id: variantId,
    title: [name, color, size].filter(Boolean).join(" - "),
    description: readString(value, "description"),
    link: `${STORE_ORIGIN}${path}?variant=${encodeURIComponent(variantId)}`,
    canonicalLink: `${STORE_ORIGIN}${path}`,
    images,
    availability: readNumber(value, "stock") > 0 ? "in_stock" : "out_of_stock",
    priceInCents: originalPrice > effectivePrice ? originalPrice : effectivePrice,
    ...(originalPrice > effectivePrice ? { salePriceInCents: effectivePrice } : {}),
    condition: condition(readString(value, "merchant_condition")),
    brand: "curti Z",
    ...(readString(value, "gtin") ? { gtin: readString(value, "gtin") } : {}),
    ...(readString(value, "mpn") ? { mpn: readString(value, "mpn") } : {}),
    ...(typeof identifierValue === "boolean" ? { identifierExists: identifierValue } : {}),
    ...(readString(value, "google_product_category")
      ? { googleProductCategory: readString(value, "google_product_category") }
      : {}),
    productType: readString(value, "product_type"),
    color,
    size,
    gender: gender(readString(value, "merchant_gender")),
    ageGroup: ageGroup(readString(value, "merchant_age_group")),
    itemGroupId: productId,
    itemGroupTitle: name
  };
}

export function buildGoogleMerchantFeed(
  data: unknown,
  generatedAt = new Date()
): MerchantFeedResult {
  const candidates = Array.isArray(data) ? data.flatMap((row) => {
    const item = merchantItem(row);
    return item ? [item] : [];
  }) : [];
  const eligibleItems: MerchantCatalogItem[] = [];
  const rejectionCounts: Record<string, number> = {};

  for (const item of candidates) {
    const eligibility = evaluateMerchantEligibility(item);
    if (eligibility.eligible) {
      eligibleItems.push(item);
      continue;
    }
    for (const reason of eligibility.reasons) {
      rejectionCounts[reason] = (rejectionCounts[reason] ?? 0) + 1;
    }
  }

  return {
    xml: merchantFeedXml(eligibleItems, {
      title: "Catálogo de produtos curti Z",
      description: "Produtos ativos da loja oficial curti Z",
      link: STORE_ORIGIN,
      generatedAt
    }),
    eligible: eligibleItems.length,
    rejected: candidates.length - eligibleItems.length,
    rejectionCounts
  };
}
