import type { Metadata } from "next";
import { isValidGtin, type Product } from "@curtiz/domain";

export const BRAND_NAME = "curti Z";
export const BRAND_ALTERNATE_NAMES = ["curtiZ", "Curtiz", "curti z"] as const;
export const OFFICIAL_STORE_ORIGIN = "https://curtiz.com.br";

export const STORE_DESCRIPTION =
  "Chinelos, slides e sandálias curti Z com conforto, design e compra online segura.";

export function officialUrl(path = "/"): string {
  return new URL(path, `${OFFICIAL_STORE_ORIGIN}/`).toString();
}

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</gu, "\\u003c");
}

export const websiteStructuredData = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${OFFICIAL_STORE_ORIGIN}/#website`,
  url: officialUrl(),
  name: BRAND_NAME,
  alternateName: [...BRAND_ALTERNATE_NAMES],
  inLanguage: "pt-BR",
  publisher: { "@id": `${OFFICIAL_STORE_ORIGIN}/#organization` }
};

export const organizationStructuredData = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${OFFICIAL_STORE_ORIGIN}/#organization`,
  name: BRAND_NAME,
  alternateName: [...BRAND_ALTERNATE_NAMES],
  url: officialUrl()
};

export const catalogNavigationStructuredData = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Categorias e seleções da curti Z",
  itemListElement: [
    ["Todos os produtos", "/produtos"],
    ["Masculino", "/masculino"],
    ["Feminino", "/feminino"],
    ["Infantil", "/infantil"],
    ["Slides", "/slides"],
    ["Sandálias", "/sandalias"],
    ["Lançamentos", "/lancamentos"],
    ["Ofertas", "/ofertas"],
    ["Mais vendidos", "/mais-vendidos"]
  ].map(([name, path], index) => ({
    "@type": "ListItem",
    position: index + 1,
    name,
    url: officialUrl(path)
  }))
};

export const homeMetadata: Metadata = {
  title: { absolute: "curti Z | Chinelos, slides e sandálias" },
  description: STORE_DESCRIPTION,
  alternates: { canonical: officialUrl() },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: BRAND_NAME,
    title: "curti Z | Chinelos, slides e sandálias",
    description: STORE_DESCRIPTION,
    url: officialUrl()
  },
  twitter: {
    card: "summary",
    title: "curti Z | Chinelos, slides e sandálias",
    description: STORE_DESCRIPTION
  }
};

export const searchMetadata: Metadata = {
  title: "Busca",
  description: "Busque produtos no catálogo da curti Z.",
  robots: { index: false, follow: true }
};

const categoryRoutes: Record<Product["category"], `/${string}`> = {
  Masculino: "/masculino",
  Feminino: "/feminino",
  Infantil: "/infantil",
  Slides: "/slides",
  Sandálias: "/sandalias"
};

export function productCategoryPath(category: Product["category"]): `/${string}` {
  return categoryRoutes[category];
}

export function breadcrumbStructuredData(
  items: ReadonlyArray<{ name: string; path: string }>
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: officialUrl(item.path)
    }))
  };
}

type ProductSeoDetail = {
  product: Product;
  gallery: Array<{ src: string }>;
  variants: Array<{
    id?: string;
    sku?: string;
    gtin?: string;
    mpn?: string;
    color?: string;
    size?: string;
    priceInCents: number;
    stock: number;
  }>;
  merchant?: { condition?: "new" | "refurbished" | "used" };
};

export function productSeoDescription(product: Product): string {
  const description =
    product.description.trim().replace(/\s+/gu, " ") ||
    `${product.name} da curti Z, com opções de cores e tamanhos conforme disponibilidade.`;
  if (description.length <= 160) return description;
  const excerpt = description.slice(0, 157).replace(/\s+\S*$/u, "").trimEnd();
  return `${excerpt}…`;
}

export function productMetadata(detail: ProductSeoDetail): Metadata {
  const { product } = detail;
  const path = `/produto/${encodeURIComponent(product.slug)}`;
  const title = `${product.name} | ${BRAND_NAME}`;
  const description = productSeoDescription(product);
  const image = detail.gallery[0]?.src ?? product.image;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: officialUrl(path) },
    openGraph: {
      type: "website",
      siteName: BRAND_NAME,
      locale: "pt_BR",
      title,
      description,
      url: officialUrl(path),
      ...(image ? { images: [{ url: image, alt: `${product.name} da ${BRAND_NAME}` }] } : {})
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image ? { images: [image] } : {})
    }
  };
}

export function productStructuredData(detail: ProductSeoDetail, preferredVariantId?: string) {
  const { product } = detail;
  const path = `/produto/${encodeURIComponent(product.slug)}`;
  const selectedVariant =
    (preferredVariantId
      ? detail.variants.find((variant) => variant.id === preferredVariantId)
      : undefined) ??
    detail.variants.find((variant) => variant.stock > 0) ??
    detail.variants[0];
  const priceInCents = selectedVariant?.priceInCents ?? product.priceInCents;
  const images = [...new Set([detail.gallery[0]?.src, ...detail.gallery.map((image) => image.src), product.image])]
    .filter((image): image is string => Boolean(image));

  const gtin = selectedVariant?.gtin?.trim();
  const gtinProperty = gtin && isValidGtin(gtin)
    ? { [`gtin${gtin.length}`]: gtin }
    : {};
  const condition = detail.merchant?.condition
    ? {
        new: "https://schema.org/NewCondition",
        refurbished: "https://schema.org/RefurbishedCondition",
        used: "https://schema.org/UsedCondition"
      }[detail.merchant.condition]
    : undefined;
  const variantUrl = selectedVariant?.id
    ? `${officialUrl(path)}?variant=${encodeURIComponent(selectedVariant.id)}`
    : officialUrl(path);

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${officialUrl(path)}#product`,
    url: officialUrl(path),
    name: product.name,
    description: productSeoDescription(product),
    image: images,
    category: product.category,
    color: product.colors,
    size: product.sizes,
    ...(selectedVariant?.sku ? { sku: selectedVariant.sku } : {}),
    ...(selectedVariant?.mpn ? { mpn: selectedVariant.mpn } : {}),
    ...gtinProperty,
    brand: {
      "@type": "Brand",
      name: BRAND_NAME
    },
    offers: {
      "@type": "Offer",
      url: variantUrl,
      priceCurrency: "BRL",
      price: (priceInCents / 100).toFixed(2),
      ...(selectedVariant?.sku ? { sku: selectedVariant.sku } : {}),
      ...(condition ? { itemCondition: condition } : {}),
      availability:
        (selectedVariant?.stock ?? product.stock) > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock"
    },
    ...(product.reviews > 0 && product.rating > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: product.rating,
            reviewCount: product.reviews
          }
        }
      : {})
  };
}

export function productBreadcrumbStructuredData(product: Product) {
  const categoryPath = productCategoryPath(product.category);
  return breadcrumbStructuredData([
    { name: BRAND_NAME, path: "/" },
    { name: product.category, path: categoryPath },
    { name: product.name, path: `/produto/${encodeURIComponent(product.slug)}` }
  ]);
}
