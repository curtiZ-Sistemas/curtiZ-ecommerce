export type MerchantCondition = "new" | "refurbished" | "used";
export type MerchantGender = "male" | "female" | "unisex";
export type MerchantAgeGroup = "newborn" | "infant" | "toddler" | "kids" | "adult";

export type MerchantImage = {
  url: string;
  width: number;
  height: number;
};

export type MerchantCatalogItem = {
  id: string;
  title: string;
  description: string;
  link: string;
  canonicalLink: string;
  images: MerchantImage[];
  availability: "in_stock" | "out_of_stock";
  priceInCents: number;
  salePriceInCents?: number;
  condition?: MerchantCondition;
  brand: string;
  gtin?: string;
  mpn?: string;
  identifierExists?: boolean;
  googleProductCategory?: string;
  productType: string;
  color: string;
  size: string;
  gender?: MerchantGender;
  ageGroup?: MerchantAgeGroup;
  itemGroupId: string;
  itemGroupTitle: string;
};

export type MerchantEligibility = {
  eligible: boolean;
  reasons: string[];
  warnings: string[];
};

const merchantOrigin = "https://curtiz.com.br";
const validGtinLengths = new Set([8, 12, 13, 14]);

export function isValidGtin(value: string): boolean {
  const gtin = value.trim();
  if (!/^\d+$/u.test(gtin) || !validGtinLengths.has(gtin.length)) return false;
  if (/^(?:02|04|2|98|99)/u.test(gtin)) return false;

  const digits = [...gtin].map(Number);
  const checkDigit = digits.pop();
  if (checkDigit === undefined) return false;
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
}

function isOfficialProductUrl(value: string, allowQuery: boolean): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === merchantOrigin &&
      /^\/produto\/[^/]+$/u.test(url.pathname) &&
      (allowQuery || !url.search)
    );
  } catch {
    return false;
  }
}

function isPublicImageUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function evaluateMerchantEligibility(item: MerchantCatalogItem): MerchantEligibility {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const mainImage = item.images[0];

  if (!item.id.trim()) reasons.push("Variação sem identificador estável.");
  if (!item.itemGroupId.trim()) reasons.push("Produto sem item_group_id estável.");
  if (!item.title.trim()) reasons.push("Produto sem título.");
  if (!item.description.trim()) reasons.push("Produto sem descrição.");
  if (!isOfficialProductUrl(item.link, true)) {
    reasons.push("URL da variação não usa o domínio oficial curtiz.com.br.");
  }
  if (!isOfficialProductUrl(item.canonicalLink, false)) {
    reasons.push("Canonical do produto não usa o domínio oficial curtiz.com.br.");
  }
  if (!mainImage || !isPublicImageUrl(mainImage.url)) {
    reasons.push("Produto sem imagem principal pública em HTTPS.");
  } else {
    if (mainImage.width < 500 || mainImage.height < 500) {
      reasons.push("Imagem principal menor que 500 x 500 pixels.");
    }
    if (mainImage.width * mainImage.height > 64_000_000) {
      reasons.push("Imagem principal excede 64 megapixels.");
    }
  }
  if (!Number.isInteger(item.priceInCents) || item.priceInCents <= 0) {
    reasons.push("Preço da variação ausente ou inválido.");
  }
  if (
    item.salePriceInCents !== undefined &&
    (!Number.isInteger(item.salePriceInCents) ||
      item.salePriceInCents <= 0 ||
      item.salePriceInCents >= item.priceInCents)
  ) {
    reasons.push("Preço promocional não é menor que o preço original.");
  }
  if (!item.condition) reasons.push("Condição do produto não informada.");
  if (item.brand.trim() !== "curti Z") reasons.push("Marca oficial do produto não confirmada.");
  if (!item.productType.trim()) reasons.push("Tipo de produto não informado.");
  if (!item.color.trim()) reasons.push("Cor da variação não informada.");
  if (!item.size.trim()) reasons.push("Tamanho da variação não informado.");
  if (!item.gender) reasons.push("Gênero do produto não informado.");
  if (!item.ageGroup) reasons.push("Faixa etária do produto não informada.");

  const gtin = item.gtin?.trim();
  const mpn = item.mpn?.trim();
  if (gtin && !isValidGtin(gtin)) reasons.push("GTIN/EAN inválido.");
  if (item.identifierExists === undefined) {
    reasons.push("Disponibilidade de GTIN/MPN não confirmada.");
  } else if (item.identifierExists && !gtin && !mpn) {
    reasons.push("Produto marcado com identificador, mas sem GTIN ou MPN.");
  } else if (!item.identifierExists && (gtin || mpn)) {
    reasons.push("Produto marcado sem identificadores, mas possui GTIN ou MPN.");
  }

  if (!item.googleProductCategory?.trim()) {
    warnings.push("Categoria Google não informada; será usada a classificação automática.");
  }
  if (item.images.length === 1) warnings.push("Produto possui somente uma imagem pública.");

  return { eligible: reasons.length === 0, reasons, warnings };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const xmlElement = (name: string, value: string | number | undefined) =>
  value === undefined || value === "" ? "" : `<${name}>${escapeXml(String(value))}</${name}>`;

export function merchantFeedXml(
  items: readonly MerchantCatalogItem[],
  options: { title: string; description: string; link: string; generatedAt: Date }
): string {
  const body = items
    .map((item) => {
      const variantOptions = [
        ["color", item.color],
        ["size", item.size]
      ]
        .map(
          ([name, value]) =>
            `<g:variant_option>${xmlElement("g:name", name)}${xmlElement("g:value", value)}</g:variant_option>`
        )
        .join("");
      const additionalImages = item.images
        .slice(1, 11)
        .map((image) => xmlElement("g:additional_image_link", image.url))
        .join("");

      return [
        "<item>",
        xmlElement("g:id", item.id),
        xmlElement("g:title", item.title),
        xmlElement("g:description", item.description),
        xmlElement("g:link", item.link),
        xmlElement("g:canonical_link", item.canonicalLink),
        xmlElement("g:image_link", item.images[0]?.url),
        additionalImages,
        xmlElement("g:availability", item.availability),
        xmlElement("g:price", `${(item.priceInCents / 100).toFixed(2)} BRL`),
        item.salePriceInCents === undefined
          ? ""
          : xmlElement("g:sale_price", `${(item.salePriceInCents / 100).toFixed(2)} BRL`),
        xmlElement("g:condition", item.condition),
        xmlElement("g:brand", item.brand),
        xmlElement("g:gtin", item.gtin),
        xmlElement("g:mpn", item.mpn),
        item.identifierExists === false ? xmlElement("g:identifier_exists", "no") : "",
        xmlElement("g:google_product_category", item.googleProductCategory),
        xmlElement("g:product_type", item.productType),
        xmlElement("g:color", item.color),
        xmlElement("g:size", item.size),
        xmlElement("g:gender", item.gender),
        xmlElement("g:age_group", item.ageGroup),
        xmlElement("g:size_system", "BR"),
        xmlElement("g:item_group_id", item.itemGroupId),
        xmlElement("g:item_group_title", item.itemGroupTitle),
        variantOptions,
        "</item>"
      ].join("");
    })
    .join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    "<channel>",
    xmlElement("title", options.title),
    xmlElement("description", options.description),
    xmlElement("link", options.link),
    xmlElement("lastBuildDate", options.generatedAt.toUTCString()),
    body,
    "</channel>",
    "</rss>"
  ].join("");
}
