import "server-only";

import type { HomepageSection, HomepageSectionType, Product } from "@curtiz/domain";
import { cache } from "react";
import { z } from "zod";
import { demoProducts, findProduct } from "./catalog";
import {
  parseCatalogFilters,
  queryDemoCatalog,
  type CatalogResult,
  type CatalogSort
} from "./catalog-query";
import { parseCatalogRpcResult, productCategory, publicCatalogImage } from "./catalog-result";
import { isPresentationCatalogEnabled } from "./presentation-catalog";
import { createServerSupabaseClient } from "./supabase/server";
import { isUnknownRecord, readNumber, readQueryResult, readRows, readString } from "./unknown-data";

export type PublicBanner = {
  id: string;
  title: string;
  subtitle?: string;
  desktopImage: string;
  mobileImage: string;
  href: string;
  position: string;
};

export type HomepageData = {
  sections: HomepageSection[];
  banners: PublicBanner[];
  products: Product[];
  source: "supabase" | "demo";
};

export type ProductVariantOption = {
  id: string;
  color: string;
  colorHex?: string;
  size: string;
  priceInCents: number;
  stock: number;
  image?: string;
};

export type ProductReview = {
  id: string;
  rating: number;
  title?: string;
  content: string;
  verified: boolean;
  helpfulVotes: number;
  createdAt: string;
};

export type ProductDetailData = {
  product: Product;
  gallery: Array<{ id: string; src: string; alt: string }>;
  variants: ProductVariantOption[];
  specifications: Array<{ label: string; value: string }>;
  reviews: ProductReview[];
  source: "supabase" | "demo";
};

export type PublicCmsPage = {
  title: string;
  summary: string;
  paragraphs: string[];
  seoTitle?: string;
  seoDescription?: string;
};

const sectionTypes = new Set<HomepageSectionType>([
  "banner_hero",
  "featured_products",
  "categories_grid",
  "banner_promo",
  "reviews_carousel",
  "brands_strip",
  "custom_banner"
]);

const defaultSections: HomepageSection[] = [
  {
    id: "default-hero",
    sectionType: "banner_hero",
    settings: { position: "hero" },
    active: true,
    sortOrder: 1
  },
  {
    id: "default-categories",
    sectionType: "categories_grid",
    title: "Para todos os momentos",
    subtitle: "Encontre seu estilo",
    settings: {},
    active: true,
    sortOrder: 2
  },
  {
    id: "default-featured",
    sectionType: "featured_products",
    title: "Ofertas em destaque",
    subtitle: "Seleção especial",
    settings: { limit: 8, sort: "discount", href: "/ofertas" },
    active: true,
    sortOrder: 3
  },
  {
    id: "default-benefits",
    sectionType: "brands_strip",
    title: "Comprar na curti Z é simples",
    settings: {},
    active: true,
    sortOrder: 4
  }
];

const fallbackBanner: PublicBanner = {
  id: "default-hero-banner",
  title: "Conheça os lançamentos da Curtiz",
  desktopImage: "/images/hero-curtiz-desktop.png",
  mobileImage: "/images/hero-curtiz-mobile.png",
  href: "/lancamentos",
  position: "hero"
};

const safeDestination = (value: string) =>
  value.startsWith("/") && !value.startsWith("//") ? value : "/produtos";

const publicImage = (path: string) => {
  if (path.startsWith("/") || path.startsWith("https://")) return path;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return url
    ? `${url}/storage/v1/object/public/catalog-public/${path.replace(/^catalog-public\//u, "")}`
    : "/icon.svg";
};

export async function queryPublicCatalog(
  options: {
    query?: string;
    category?: string;
    sort?: CatalogSort;
    pageSize?: number;
    promotion?: boolean;
    newest?: boolean;
  } = {}
): Promise<CatalogResult | null> {
  const filters = {
    ...parseCatalogFilters(new URLSearchParams(), options.category),
    query: options.query,
    sort: options.sort ?? "relevant",
    pageSize: Math.min(24, Math.max(1, options.pageSize ?? 12)),
    promotion: options.promotion ?? false,
    newest: options.newest ?? false
  };
  if (process.env.DEMO_MODE === "true") return queryDemoCatalog(filters);
  const presentationFallback = isPresentationCatalogEnabled();

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return presentationFallback || process.env.NODE_ENV !== "production"
      ? queryDemoCatalog(filters)
      : null;
  }
  const response: unknown = await supabase.rpc("search_catalog", {
    p_query: filters.query ?? null,
    p_category: filters.category ?? null,
    p_collection: null,
    p_colors: [],
    p_sizes: [],
    p_price_min: null,
    p_price_max: null,
    p_promotion: filters.promotion,
    p_in_stock: true,
    p_featured: filters.newest,
    p_min_rating: null,
    p_sort: filters.sort,
    p_page: 1,
    p_page_size: filters.pageSize
  });
  const { data, error } = readQueryResult(response);
  if (!error) {
    const catalog = parseCatalogRpcResult(data, { page: 1, pageSize: filters.pageSize });
    if (catalog) return catalog;
  }
  return presentationFallback ? queryDemoCatalog(filters) : null;
}

export const getHomepageData = cache(async (): Promise<HomepageData> => {
  if (process.env.DEMO_MODE === "true") {
    return {
      sections: defaultSections,
      banners: [fallbackBanner],
      products: demoProducts,
      source: "demo"
    };
  }
  const presentationFallback = isPresentationCatalogEnabled();
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    const developmentFallback =
      presentationFallback || process.env.NODE_ENV !== "production";
    return {
      sections: defaultSections,
      banners: developmentFallback ? [fallbackBanner] : [],
      products: developmentFallback ? demoProducts : [],
      source: "demo"
    };
  }

  const [sectionsResponse, bannersResponse, catalog] = await Promise.all([
    supabase
      .from("homepage_sections")
      .select("id,section_type,title,subtitle,settings,active,starts_at,ends_at,sort_order")
      .eq("active", true)
      .order("sort_order")
      .limit(20),
    supabase
      .from("banners")
      .select(
        "id,title,subtitle,image_path_desktop,image_path_mobile,destination_url,position,sort_order"
      )
      .eq("status", "published")
      .order("sort_order")
      .limit(40),
    queryPublicCatalog({ sort: "best_sellers", pageSize: 12 })
  ]);

  const sections = readRows(readQueryResult(sectionsResponse).data)
    .map((row): HomepageSection | null => {
      const sectionType = readString(row, "section_type") as HomepageSectionType;
      if (!sectionTypes.has(sectionType)) return null;
      const rawSettings = row.settings;
      return {
        id: readString(row, "id"),
        sectionType,
        ...(readString(row, "title") ? { title: readString(row, "title") } : {}),
        ...(readString(row, "subtitle") ? { subtitle: readString(row, "subtitle") } : {}),
        settings: isUnknownRecord(rawSettings) ? rawSettings : {},
        active: true,
        ...(readString(row, "starts_at") ? { startsAt: readString(row, "starts_at") } : {}),
        ...(readString(row, "ends_at") ? { endsAt: readString(row, "ends_at") } : {}),
        sortOrder: readNumber(row, "sort_order")
      };
    })
    .filter((section): section is HomepageSection => Boolean(section));

  const positionCounts = new Map<string, number>();
  const banners = readRows(readQueryResult(bannersResponse).data)
    .map((row): PublicBanner | null => {
      const position = readString(row, "position") || "hero";
      const count = positionCounts.get(position) ?? 0;
      if (count >= 4) return null;
      positionCounts.set(position, count + 1);
      const desktop = readString(row, "image_path_desktop");
      const mobile = readString(row, "image_path_mobile");
      if (!desktop || !mobile) return null;
      return {
        id: readString(row, "id"),
        title: readString(row, "title"),
        ...(readString(row, "subtitle") ? { subtitle: readString(row, "subtitle") } : {}),
        desktopImage: publicImage(desktop),
        mobileImage: publicImage(mobile),
        href: safeDestination(readString(row, "destination_url")),
        position
      };
    })
    .filter((banner): banner is PublicBanner => Boolean(banner));

  const fallbackBannerEnabled = banners.length === 0 && presentationFallback;
  const fallbackProductsEnabled = !catalog && presentationFallback;

  return {
    sections: sections.length ? sections : defaultSections,
    banners: fallbackBannerEnabled
      ? [fallbackBanner]
      : banners.length || process.env.NODE_ENV === "production"
        ? banners
        : [fallbackBanner],
    products: fallbackProductsEnabled ? demoProducts : (catalog?.products ?? []),
    source: fallbackBannerEnabled || fallbackProductsEnabled ? "demo" : "supabase"
  };
});

const productDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string(),
  priceInCents: z.coerce.number().int().nonnegative(),
  compareAtPriceInCents: z.coerce.number().int().positive().nullable().optional(),
  rating: z.coerce.number().min(0).max(5),
  reviews: z.coerce.number().int().nonnegative(),
  featured: z.boolean(),
  stock: z.coerce.number().int().nonnegative(),
  variants: z.array(
    z.object({
      id: z.string(),
      color: z.string(),
      colorHex: z.string().nullable().optional(),
      size: z.string(),
      priceInCents: z.coerce.number().int().nonnegative(),
      stock: z.coerce.number().int().nonnegative(),
      imagePath: z.string().nullable().optional()
    })
  ),
  images: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      alt: z.string()
    })
  ),
  specifications: z.array(z.object({ label: z.string(), value: z.string() })),
  recentReviews: z.array(
    z.object({
      id: z.string(),
      rating: z.coerce.number().int().min(1).max(5),
      title: z.string().nullable().optional(),
      content: z.string(),
      verified: z.boolean(),
      helpfulVotes: z.coerce.number().int().nonnegative(),
      createdAt: z.string()
    })
  )
});

const demoProductDetail = (slug: string): ProductDetailData | null => {
  const product = findProduct(slug);
  if (!product || product.stock <= 0) return null;
  const variants = product.colors.flatMap((color) =>
    product.sizes.map((size) => ({
      id: `${product.id}:${color}:${size}`,
      color,
      size,
      priceInCents: product.priceInCents,
      stock: product.stock,
      image: product.image
    }))
  );
  return {
    product,
    gallery: [{ id: `${product.id}-primary`, src: product.image, alt: product.name }],
    variants,
    specifications: [],
    reviews: [],
    source: "demo"
  };
};

export const getPublicProduct = cache(async (slug: string): Promise<ProductDetailData | null> => {
  if (process.env.DEMO_MODE === "true") return demoProductDetail(slug);
  const presentationFallback = isPresentationCatalogEnabled();
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return presentationFallback || process.env.NODE_ENV !== "production"
      ? demoProductDetail(slug)
      : null;
  }
  const response: unknown = await supabase.rpc("get_catalog_product", { p_slug: slug });
  const { data, error } = readQueryResult(response);
  if (error) return presentationFallback ? demoProductDetail(slug) : null;
  if (!data) return null;
  const parsed = productDetailSchema.safeParse(data);
  if (!parsed.success) return presentationFallback ? demoProductDetail(slug) : null;
  if (parsed.data.stock <= 0) return null;
  const firstImage = parsed.data.images[0]?.path;
  const colors = [...new Set(parsed.data.variants.map((variant) => variant.color))];
  const sizes = [...new Set(parsed.data.variants.map((variant) => variant.size))];
  const product: Product = {
    id: parsed.data.id,
    slug: parsed.data.slug,
    name: parsed.data.name,
    category: productCategory(parsed.data.category),
    description: parsed.data.description,
    priceInCents: parsed.data.priceInCents,
    ...(parsed.data.compareAtPriceInCents
      ? { compareAtPriceInCents: parsed.data.compareAtPriceInCents }
      : {}),
    rating: parsed.data.rating,
    reviews: parsed.data.reviews,
    colors,
    sizes,
    image: publicCatalogImage(firstImage, parsed.data.slug),
    featured: parsed.data.featured,
    stock: parsed.data.stock
  };
  return {
    product,
    gallery: parsed.data.images.map((image) => ({
      id: image.id,
      src: publicCatalogImage(image.path, parsed.data.slug),
      alt: image.alt
    })),
    variants: parsed.data.variants.map((variant) => ({
      id: variant.id,
      color: variant.color,
      ...(variant.colorHex ? { colorHex: variant.colorHex } : {}),
      size: variant.size,
      priceInCents: variant.priceInCents,
      stock: variant.stock,
      ...(variant.imagePath
        ? { image: publicCatalogImage(variant.imagePath, parsed.data.slug) }
        : {})
    })),
    specifications: parsed.data.specifications,
    reviews: parsed.data.recentReviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      ...(review.title ? { title: review.title } : {}),
      content: review.content,
      verified: review.verified,
      helpfulVotes: review.helpfulVotes,
      createdAt: review.createdAt
    })),
    source: "supabase"
  };
});

const cmsParagraphs = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").slice(0, 40);
  }
  if (!isUnknownRecord(value) || !Array.isArray(value.blocks)) return [];
  return value.blocks
    .filter(isUnknownRecord)
    .map((block) => readString(block, "text"))
    .filter(Boolean)
    .slice(0, 40);
};

export const getPublicCmsPage = cache(async (slug: string): Promise<PublicCmsPage | null> => {
  if (process.env.DEMO_MODE === "true") return null;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;
  const response = await supabase
    .from("cms_pages")
    .select("title,summary,content_sanitized,seo_title,seo_description")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  const data = readQueryResult(response).data;
  if (!isUnknownRecord(data)) return null;
  return {
    title: readString(data, "title"),
    summary: readString(data, "summary"),
    paragraphs: cmsParagraphs(data.content_sanitized),
    ...(readString(data, "seo_title") ? { seoTitle: readString(data, "seo_title") } : {}),
    ...(readString(data, "seo_description")
      ? { seoDescription: readString(data, "seo_description") }
      : {})
  };
});
