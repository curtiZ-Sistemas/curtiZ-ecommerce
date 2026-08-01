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
