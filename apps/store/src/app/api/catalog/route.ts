import type { Product } from "@curtiz/domain";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  parseCatalogFilters,
  queryDemoCatalog,
  type CatalogResult
} from "@/lib/catalog-query";
import { demoProducts } from "@/lib/catalog";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readQueryResult } from "@/lib/unknown-data";

export const dynamic = "force-dynamic";

const rpcProductSchema = z.object({
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

const facetSchema = z.object({
  categories: z.array(z.object({ value: z.string(), label: z.string(), count: z.coerce.number() })),
  collections: z.array(z.object({ value: z.string(), label: z.string(), count: z.coerce.number() })),
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

const rpcResultSchema = z.object({
  products: z.array(rpcProductSchema),
  facets: facetSchema,
  total: z.coerce.number().int().nonnegative()
});

const productCategory = (value: string): Product["category"] => {
  const allowed: Product["category"][] = [
    "Masculino",
    "Feminino",
    "Infantil",
    "Slides",
    "Sandálias"
  ];
  return allowed.includes(value as Product["category"]) ? (value as Product["category"]) : "Slides";
};

const publicCatalogImage = (path: string | null | undefined, slug: string) => {
  if (!path) return demoProducts.find((product) => product.slug === slug)?.image ?? "/icon.svg";
  if (path.startsWith("/") || path.startsWith("https://")) return path;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return url
    ? `${url}/storage/v1/object/public/catalog-public/${path.replace(/^catalog-public\//u, "")}`
    : "/icon.svg";
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fixedCategory = url.searchParams.get("categoria_fixa") ?? undefined;
  const filters = parseCatalogFilters(url.searchParams, fixedCategory);
  if (process.env.DEMO_MODE === "true") {
    return NextResponse.json(queryDemoCatalog(filters), {
      headers: { "cache-control": "private, no-store", "x-catalog-source": "demo" }
    });
  }
  const supabase = await createServerSupabaseClient();

  if (supabase) {
    const rpcResponse: unknown = await supabase.rpc("search_catalog", {
      p_query: filters.query ?? null,
      p_category: filters.category ?? null,
      p_collection: filters.collection ?? null,
      p_colors: filters.colors,
      p_sizes: filters.sizes,
      p_price_min: filters.priceMin ?? null,
      p_price_max: filters.priceMax ?? null,
      p_promotion: filters.promotion,
      p_in_stock: filters.inStock,
      p_featured: filters.newest,
      p_min_rating: filters.minRating ?? null,
      p_sort: filters.sort,
      p_page: filters.page,
      p_page_size: filters.pageSize
    });
    const { data, error } = readQueryResult(rpcResponse);
    if (!error) {
      const parsed = rpcResultSchema.safeParse(data);
      if (parsed.success) {
        const result: CatalogResult = {
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
          page: filters.page,
          pageSize: filters.pageSize,
          source: "supabase"
        };
        return NextResponse.json(result, {
          headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" }
        });
      }
    }
  }

  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json(queryDemoCatalog(filters), {
      headers: { "cache-control": "private, no-store", "x-catalog-source": "demo" }
    });
  }

  return NextResponse.json(
    { message: "Não foi possível carregar o catálogo agora." },
    { status: 503, headers: { "cache-control": "no-store" } }
  );
}
