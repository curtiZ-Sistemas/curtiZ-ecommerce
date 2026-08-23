import { NextResponse } from "next/server";
import { parseCatalogFilters, queryDemoCatalog } from "@/lib/catalog-query";
import { parseCatalogRpcResult, parseRpcProductList } from "@/lib/catalog-result";
import { isPresentationCatalogEnabled } from "@/lib/presentation-catalog";
import { createPublicSupabaseClient } from "@/lib/supabase/server";
import { readQueryResult } from "@/lib/unknown-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fixedCategory = url.searchParams.get("categoria_fixa") ?? undefined;
  const compact = url.searchParams.get("compacto") === "1";
  const suggestions = url.searchParams.get("sugestoes") === "1";
  const filters = parseCatalogFilters(url.searchParams, fixedCategory);
  if (process.env.DEMO_MODE === "true") {
    const result = queryDemoCatalog(filters);
    return NextResponse.json(compact ? { products: result.products } : result, {
      headers: { "cache-control": "private, no-store", "x-catalog-source": "demo" }
    });
  }
  const presentationFallback = isPresentationCatalogEnabled();

  const supabase = createPublicSupabaseClient();
  if (supabase) {
    if (suggestions && filters.query) {
      const suggestionResponse: unknown = await supabase.rpc("search_catalog_suggestions", {
        p_query: filters.query,
        p_limit: Math.min(filters.pageSize, 8)
      });
      const suggestionResult = readQueryResult(suggestionResponse);
      const suggestionProducts = suggestionResult.error
        ? null
        : parseRpcProductList(suggestionResult.data);
      if (suggestionProducts) {
        return NextResponse.json(
          {
            products: suggestionProducts,
            facets: { categories: [], collections: [], colors: [], sizes: [], price: { min: 0, max: 0 }, promotionCount: 0, inStockCount: 0, newestCount: 0 },
            total: suggestionProducts.length,
            page: 1,
            pageSize: suggestionProducts.length,
            source: "supabase"
          },
          { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=120" } }
        );
      }
    }
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
      const result = parseCatalogRpcResult(data, {
        page: filters.page,
        pageSize: filters.pageSize
      });
      if (result) {
        return NextResponse.json(compact ? { products: result.products } : result, {
          headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" }
        });
      }
    }
  }

  if (presentationFallback || process.env.NODE_ENV !== "production") {
    const result = queryDemoCatalog(filters);
    return NextResponse.json(compact ? { products: result.products } : result, {
      headers: { "cache-control": "private, no-store", "x-catalog-source": "demo" }
    });
  }

  return NextResponse.json(
    { message: "Não foi possível carregar o catálogo agora." },
    { status: 503, headers: { "cache-control": "no-store" } }
  );
}
