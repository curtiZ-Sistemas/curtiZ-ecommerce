export type AppRole =
  "customer" | "representative" | "operational" | "admin" | "manager" | "technical";

export type Product = {
  id: string;
  slug: string;
  name: string;
  category: "Masculino" | "Feminino" | "Infantil" | "Slides" | "Sandálias";
  description: string;
  priceInCents: number;
  compareAtPriceInCents?: number;
  rating: number;
  reviews: number;
  colors: string[];
  sizes: string[];
  image: string;
  featured?: boolean;
  stock: number;
};

export type CartLine = {
  productId: string;
  slug?: string;
  variantId: string;
  name: string;
  image: string;
  color: string;
  size: string;
  quantity: number;
  maxQuantity?: number;
  unitPriceInCents: number;
};

export type IntegrationState =
  "online" | "degraded" | "offline" | "not_configured" | "awaiting_credentials" | "maintenance";

export type RequestContext = {
  requestId: string;
  userId?: string;
  role?: AppRole;
};

export type HomepageSectionType =
  | "banner_hero"
  | "product_carousel"
  | "product_grid"
  | "product_horizontal"
  | "categories_grid"
  | "models_grid"
  | "brands_strip"
  | "collections_grid"
  | "image_links"
  | "image_mosaic"
  | "promotions"
  | "flash_offers"
  | "best_sellers"
  | "launches"
  | "featured_products"
  | "recommended_products"
  | "manual_products"
  | "campaigns"
  | "benefits"
  | "reviews_carousel"
  | "editorial"
  | "video"
  | "image_text"
  | "countdown"
  | "newsletter"
  | "institutional"
  | "quick_links"
  | "safe_component";

export type HomepageSectionItem = {
  id: string;
  itemType: string;
  internalName: string;
  title?: string;
  subtitle?: string;
  description?: string;
  altText?: string;
  decorative: boolean;
  targetType: string;
  targetId?: string;
  targetRoute?: string;
  sortOrder: number;
  config: Record<string, unknown>;
  media: Array<{
    id: string;
    role: "desktop" | "tablet" | "mobile" | "video" | "background" | "thumbnail";
    path: string;
    mimeType: string;
    altText?: string;
    decorative: boolean;
    width?: number;
    height?: number;
  }>;
};

export type HomepageSection = {
  id: string;
  sectionType: HomepageSectionType;
  title?: string;
  subtitle?: string;
  description?: string;
  layout: string;
  visibility: "all" | "desktop" | "tablet" | "mobile";
  style: Record<string, unknown>;
  content: Record<string, unknown>;
  settings: Record<string, unknown>;
  items: HomepageSectionItem[];
  versionId?: string;
  active: boolean;
  startsAt?: string;
  endsAt?: string;
  sortOrder: number;
};
