import "server-only";

import type { HomepageSection, HomepageSectionItem, HomepageSectionType, Product } from "@curtiz/domain";
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
import { selectHomepageSections } from "./homepage-layout";
import { isPresentationCatalogEnabled } from "./presentation-catalog";
import { createServerSupabaseClient } from "./supabase/server";
import { isUnknownRecord, readNumber, readQueryResult, readRows, readString } from "./unknown-data";

export type PublicBanner = {
  id: string;
  title: string;
  altText: string;
  subtitle?: string;
  desktopImage: string;
  mobileImage: string;
  href?: string;
  openNewTab?: boolean;
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
  "product_carousel",
  "product_grid",
  "product_horizontal",
  "categories_grid",
  "models_grid",
  "brands_strip",
  "collections_grid",
  "image_links",
  "image_mosaic",
  "promotions",
  "flash_offers",
  "best_sellers",
  "launches",
  "featured_products",
  "recommended_products",
  "manual_products",
  "campaigns",
  "benefits",
  "reviews_carousel",
  "editorial",
  "video",
  "image_text",
  "countdown",
  "newsletter",
  "institutional",
  "quick_links",
  "safe_component"
]);

const defaultSections: HomepageSection[] = [
  {
    id: "default-hero",
    sectionType: "banner_hero",
    layout: "full_width",
    visibility: "all",
    style: {},
    content: { position: "hero" },
    settings: { position: "hero" },
    items: [],
    active: true,
    sortOrder: 1
  },
  {
    id: "default-categories",
    sectionType: "categories_grid",
    title: "Para todos os momentos",
    subtitle: "Encontre seu estilo",
    layout: "content_centered",
    visibility: "all",
    style: {},
    content: {},
    settings: {},
    items: [],
    active: true,
    sortOrder: 2
  },
  {
    id: "default-featured",
    sectionType: "featured_products",
    title: "Destaques curti Z",
    subtitle: "Escolhas para todos os estilos",
    layout: "grid",
    visibility: "all",
    style: {},
    content: { limit: 8, href: "/produtos" },
    settings: { limit: 8, href: "/produtos" },
    items: [],
    active: true,
    sortOrder: 3
  },
  {
    id: "default-benefits",
    sectionType: "benefits",
    title: "Comprar na curti Z é simples",
    layout: "four_columns",
    visibility: "all",
    style: {},
    content: {},
    settings: {},
    items: [],
    active: true,
    sortOrder: 4
  }
];

const fallbackBanner: PublicBanner = {
  id: "default-hero-banner",
  title: "Conheça os lançamentos da Curtiz",
  altText: "Conheça os lançamentos da Curtiz",
  desktopImage: "/images/hero-curtiz-desktop.png",
  mobileImage: "/images/hero-curtiz-mobile.png",
  href: "/lancamentos",
  position: "hero"
};

const safeDestination = (value: string) => {
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : "/produtos";
  } catch {
    return "/produtos";
  }
};

const publicImage = (path: string) => {
  if (path.startsWith("/") || path.startsWith("https://")) return path;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return url
    ? `${url}/storage/v1/object/public/catalog-public/${path.replace(/^catalog-public\//u, "")}`
    : "/icon.svg";
};

const homepageMedia = (path: string) => {
  if (path.startsWith("/") || path.startsWith("https://")) return path;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return url
    ? `${url}/storage/v1/object/public/homepage-public/${path.replace(/^homepage-public\//u, "")}`
    : "/icon.svg";
};

function mapHomepageItem(value: unknown): HomepageSectionItem | null {
  if (!isUnknownRecord(value)) return null;
  const id = readString(value, "id");
  const internalName = readString(value, "internalName") || readString(value, "title") || "Item";
  if (!id) return null;
  const media = Array.isArray(value.media) ? value.media.flatMap((entry) => {
    if (!isUnknownRecord(entry)) return [];
    const path = readString(entry, "path");
    const role = readString(entry, "role") as HomepageSectionItem["media"][number]["role"];
    if (!path || !["desktop", "tablet", "mobile", "video", "background", "thumbnail"].includes(role)) return [];
    return [{ id: readString(entry, "id"), role, path: homepageMedia(path), mimeType: readString(entry, "mimeType"), ...(readString(entry, "altText") ? { altText: readString(entry, "altText") } : {}), decorative: entry.decorative === true, ...(readNumber(entry, "width") ? { width: readNumber(entry, "width") } : {}), ...(readNumber(entry, "height") ? { height: readNumber(entry, "height") } : {}) }];
  }) : [];
  const targetRoute = readString(value, "targetRoute");
  const safeRoute = targetRoute.startsWith("/") && !targetRoute.startsWith("//") || targetRoute.startsWith("https://") ? targetRoute : "";
  return { id, itemType: readString(value, "itemType", "content"), internalName,
    ...(readString(value, "title") ? { title: readString(value, "title") } : {}),
    ...(readString(value, "subtitle") ? { subtitle: readString(value, "subtitle") } : {}),
    ...(readString(value, "description") ? { description: readString(value, "description") } : {}),
    ...(readString(value, "altText") ? { altText: readString(value, "altText") } : {}),
    decorative: value.decorative === true, targetType: readString(value, "targetType", "none"),
    ...(readString(value, "targetId") ? { targetId: readString(value, "targetId") } : {}),
    ...(safeRoute ? { targetRoute: safeRoute } : {}), sortOrder: readNumber(value, "sortOrder"),
    config: isUnknownRecord(value.config) ? value.config : {}, media };
}

const directProductSelect = "id,slug,name,description,base_price,featured,status,categories(name),product_images(storage_path,is_primary),product_variants(color_name,size,active,inventory(available_quantity,reserved_quantity)),reviews(rating,status)";

function mapDirectProducts(data: unknown): Product[] {
  return readRows(data).flatMap((row): Product[] => {
    const variants = readRows(row.product_variants).filter((variant) => variant.active === true);
    const stock = variants.reduce((sum, variant) => {
      const inventory = readRows(variant.inventory)[0];
      return sum + Math.max(readNumber(inventory ?? {}, "available_quantity"), 0);
    }, 0);
    const images = readRows(row.product_images).sort((left, right) => Number(right.is_primary === true) - Number(left.is_primary === true));
    const category = readRows(row.categories)[0] ?? (isUnknownRecord(row.categories) ? row.categories : {});
    const reviews = readRows(row.reviews).filter((review) => readString(review, "status") === "approved");
    const rating = reviews.length ? reviews.reduce((sum, review) => sum + readNumber(review, "rating"), 0) / reviews.length : 0;
    return [{ id: readString(row, "id"), slug: readString(row, "slug"), name: readString(row, "name"),
      category: productCategory(readString(category, "name")), description: readString(row, "description"),
      priceInCents: Math.round(readNumber(row, "base_price") * 100), rating, reviews: reviews.length,
      colors: [...new Set(variants.map((variant) => readString(variant, "color_name")).filter(Boolean))],
      sizes: [...new Set(variants.map((variant) => readString(variant, "size")).filter(Boolean))],
      image: publicCatalogImage(readString(images[0] ?? {}, "storage_path"), readString(row, "slug")),
      featured: row.featured === true, stock }];
  });
}

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
    p_in_stock: false,
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

  const [sectionsResponse, bannersResponse, bestCatalog, promotionCatalog, newestCatalog] = await Promise.all([
    supabase
      .from("published_homepage_sections")
      .select("section_version_id,section_id,position,snapshot")
      .order("position")
      .limit(40),
    supabase
      .from("banners")
      .select(
        "id,title,subtitle,image_path_desktop,image_path_mobile,alt_text,destination_type,destination_url,open_new_tab,position,priority,sort_order"
      )
      .in("status", ["published", "scheduled"])
      .order("priority", { ascending: false })
      .order("sort_order")
      .limit(40),
    queryPublicCatalog({ sort: "best_sellers", pageSize: 24 }),
    queryPublicCatalog({ promotion: true, pageSize: 12 }),
    queryPublicCatalog({ newest: true, pageSize: 12 })
  ]);

  const sections = readRows(readQueryResult(sectionsResponse).data)
    .map((row): HomepageSection | null => {
      const snapshot = isUnknownRecord(row.snapshot) ? row.snapshot : null;
      if (!snapshot) return null;
      const sectionType = readString(snapshot, "sectionType") as HomepageSectionType;
      if (!sectionTypes.has(sectionType)) return null;
      const content = isUnknownRecord(snapshot.content) ? snapshot.content : {};
      const style = isUnknownRecord(snapshot.style) ? snapshot.style : {};
      const visibilityValue = readString(snapshot, "visibility", "all");
      const visibility = ["all", "desktop", "tablet", "mobile"].includes(visibilityValue) ? visibilityValue as HomepageSection["visibility"] : "all";
      const items = Array.isArray(snapshot.items) ? snapshot.items.flatMap((entry) => { const item = mapHomepageItem(entry); return item ? [item] : []; }) : [];
      return {
        id: readString(row, "section_id"),
        sectionType,
        ...(readString(snapshot, "title") ? { title: readString(snapshot, "title") } : {}),
        ...(readString(snapshot, "subtitle") ? { subtitle: readString(snapshot, "subtitle") } : {}),
        ...(readString(snapshot, "description") ? { description: readString(snapshot, "description") } : {}),
        layout: readString(snapshot, "layout", "content_centered"), visibility, style, content,
        settings: content, items,
        versionId: readString(row, "section_version_id"),
        active: true,
        ...(readString(snapshot, "startsAt") ? { startsAt: readString(snapshot, "startsAt") } : {}),
        ...(readString(snapshot, "endsAt") ? { endsAt: readString(snapshot, "endsAt") } : {}),
        sortOrder: readNumber(row, "position")
      };
    })
    .filter((section): section is HomepageSection => Boolean(section));

  const manualProductIds = [...new Set(sections.flatMap((section) => section.items.filter((item) => item.targetType === "product" && item.targetId).map((item) => item.targetId!)))].slice(0, 24);
  const manualResponse = manualProductIds.length
    ? await supabase.from("products").select(directProductSelect).in("id", manualProductIds).eq("status", "active").limit(24)
    : null;
  const manualProducts = mapDirectProducts(readQueryResult(manualResponse).data);

  const positionCounts = new Map<string, number>();
  const banners = readRows(readQueryResult(bannersResponse).data)
    .map((row): PublicBanner | null => {
      const position = readString(row, "position") || "hero";
      const count = positionCounts.get(position) ?? 0;
      if (count >= 4) return null;
      positionCounts.set(position, count + 1);
      const desktop = readString(row, "image_path_desktop");
      const mobile = readString(row, "image_path_mobile");
      if (!desktop && !mobile) return null;

      const desktopImage = desktop || mobile;
      const mobileImage = mobile || desktop;
      return {
        id: readString(row, "id"),
        title: readString(row, "title"),
        altText: readString(row, "alt_text") || readString(row, "title"),
        ...(readString(row, "subtitle") ? { subtitle: readString(row, "subtitle") } : {}),
        desktopImage: publicImage(desktopImage),
        mobileImage: publicImage(mobileImage),
        ...(readString(row, "destination_type") === "none"
          ? {}
          : { href: safeDestination(readString(row, "destination_url")) }),
        ...(row.open_new_tab === true ? { openNewTab: true } : {}),
        position
      };
    })
    .filter((banner): banner is PublicBanner => Boolean(banner));

  const fallbackBannerEnabled = banners.length === 0 && presentationFallback;
  const fallbackProductsEnabled = !bestCatalog && !promotionCatalog && !newestCatalog && presentationFallback;
  const products = [...manualProducts, ...(bestCatalog?.products ?? []), ...(promotionCatalog?.products ?? []), ...(newestCatalog?.products ?? [])]
    .filter((product, index, list) => list.findIndex((candidate) => candidate.id === product.id) === index);
  const allowDefaults = presentationFallback || process.env.NODE_ENV !== "production";
  const homepageSections = selectHomepageSections(
    sections,
    defaultSections,
    banners.length > 0 || products.length > 0,
    allowDefaults
  );

  return {
    sections: homepageSections,
    banners: fallbackBannerEnabled
      ? [fallbackBanner]
      : banners.length || process.env.NODE_ENV === "production"
        ? banners
        : [fallbackBanner],
    products: fallbackProductsEnabled ? demoProducts : products,
    source: fallbackBannerEnabled || fallbackProductsEnabled ? "demo" : "supabase"
  };
});

export const getProductsByModel = cache(async (slug: string): Promise<Product[]> => {
  if (process.env.DEMO_MODE === "true") return [];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const result = await supabase.from("products").select(`${directProductSelect},product_models!inner(slug)`).eq("status", "active").eq("product_models.slug", slug).limit(48);
  return result.error ? [] : mapDirectProducts(result.data);
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
