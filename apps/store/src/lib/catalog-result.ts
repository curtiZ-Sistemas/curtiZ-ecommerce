import type { Product } from "@curtiz/domain";
import { z } from "zod";
import { demoProducts } from "./catalog";
import type { CatalogResult } from "./catalog-query";

export const rpcProductSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string(),
  priceInCents: z.coerce.number().int().nonnegative(),
  compareAtPriceInCents: z.coerce.number().int().positive().nullable().optional(),
  rating: z.coerce.number().min(0).max(5),
  reviews: z.coerce.number().int().nonnegative(),
  colors: z.array(z.string()),
  sizes: z.array(z.string()),
  imagePath: z.string().nullable().optional(),
  featured: z.boolean(),
  stock: z.coerce.number().int().nonnegative()
});

export const facetSchema = z.object({
  categories: z.array(z.object({ value: z.string(), label: z.string(), count: z.coerce.number() })),
  collections: z.array(
    z.object({ value: z.string(), label: z.string(), count: z.coerce.number() })
  ),
  colors: z.array(
    z.object({
      value: z.string(),
      label: z.string(),
      count: z.coerce.number(),
      hex: z.string().optional()
    })
  ),
  sizes: z.array(z.object({ value: z.string(), label: z.string(), count: z.coerce.number() })),
  price: z.object({ min: z.coerce.number(), max: z.coerce.number() }),
  promotionCount: z.coerce.number(),
  inStockCount: z.coerce.number(),
  newestCount: z.coerce.number()
});

export const rpcResultSchema = z.object({
  products: z.array(rpcProductSchema),
  facets: facetSchema,
  total: z.coerce.number().int().nonnegative()
});

export const productCategory = (value: string): Product["category"] => {
  const allowed: Product["category"][] = [
    "Masculino",
    "Feminino",
    "Infantil",
    "Slides",
    "Sandálias"
  ];
  return allowed.includes(value as Product["category"]) ? (value as Product["category"]) : "Slides";
};

export const publicCatalogImage = (path: string | null | undefined, slug?: string) => {
  if (!path) return demoProducts.find((product) => product.slug === slug)?.image ?? "/icon.svg";
  if (path.startsWith("/") || path.startsWith("https://")) return path;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return url
    ? `${url}/storage/v1/object/public/catalog-public/${path.replace(/^catalog-public\//u, "")}`
    : "/icon.svg";
};

export function parseCatalogRpcResult(
  data: unknown,
  options: { page: number; pageSize: number }
): CatalogResult | null {
  const parsed = rpcResultSchema.safeParse(data);
  if (!parsed.success) return null;
  return {
    products: parsed.data.products.map((product) => ({
      id: product.id,
      slug: product.slug,
      name: product.name,
      category: productCategory(product.category),
      description: product.description,
      priceInCents: product.priceInCents,
      ...(product.compareAtPriceInCents
        ? { compareAtPriceInCents: product.compareAtPriceInCents }
        : {}),
      rating: product.rating,
      reviews: product.reviews,
      colors: product.colors,
      sizes: product.sizes,
      image: publicCatalogImage(product.imagePath, product.slug),
      featured: product.featured,
      stock: product.stock
    })),
    facets: parsed.data.facets,
    total: parsed.data.total,
    page: options.page,
    pageSize: options.pageSize,
    source: "supabase"
  };
}
