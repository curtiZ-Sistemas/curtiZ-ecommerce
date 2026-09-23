import { NextResponse } from "next/server";
import { parseCatalogFilters, queryDemoCatalog } from "@/lib/catalog-query";
import { parseCatalogRpcPage, parseCatalogRpcResult } from "@/lib/catalog-result";
import { isPresentationCatalogEnabled } from "@/lib/presentation-catalog";
import { storefrontFreshnessHeaders } from "@/lib/storefront-cache";
import { createPublicSupabaseClient } from "@/lib/supabase/server";
import { readQueryResult } from "@/lib/unknown-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fixedCategory = url.searchParams.get("categoria_fixa") ?? undefined;
  const compact = url.searchParams.get("compacto") === "1";
  const suggestions = url.searchParams.get("sugestoes") === "1";
  const filters = parseCatalogFilters(url.searchParams, fixedCategory);
  if (isPresentationCatalogEnabled()) {
    const result = queryDemoCatalog(filters);
    return NextResponse.json(compact ? { products: result.products } : result, {
      headers: { "cache-control": "private, no-store", "x-catalog-source": "demo" }
    });
  }
  const presentationFallback = isPresentationCatalogEnabled();

  const supabase = createPublicSupabaseClient();
  if (supabase) {
    const rpcArgs = {
      p_query: filters.query ?? null,
      p_category: filters.category ?? null,
      p_collection: filters.collection ?? null,
      p_colors: filters.colors,
      p_sizes: filters.sizes,
      p_price_min: filters.priceMin ?? null,
      p_price_max: filters.priceMax ?? null,
      p_promotion: filters.promotion,
      p_in_stock: filters.inStock,
      p_featured: false,
      p_min_rating: filters.minRating ?? null,
      p_sort: filters.newest ? "newest" : filters.sort,
      p_page: filters.page,
      p_page_size: suggestions ? Math.min(filters.pageSize, 8) : filters.pageSize
    };
    if (filters.page > 1 && !compact) {
      const pageResponse: unknown = await supabase.rpc("search_catalog_page", rpcArgs);
      const pageData = readQueryResult(pageResponse);
      const pageResult = pageData.error ? null : parseCatalogRpcPage(pageData.data, filters.sort);
      if (pageResult) {
        return NextResponse.json({ ...pageResult, facets: emptyFacets, page: filters.page,
          pageSize: filters.pageSize, source: "supabase" }, { headers: storefrontFreshnessHeaders });
      }
    }
    const rpcResponse: unknown = await supabase.rpc("search_catalog", rpcArgs);
    const { data, error } = readQueryResult(rpcResponse);
    if (!error) {
      const result = parseCatalogRpcResult(data, {
        page: filters.page,
        pageSize: filters.pageSize,
        sort: filters.sort
      });
      if (result) {
        return NextResponse.json(compact ? { products: result.products } : result, {
          headers: storefrontFreshnessHeaders
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

const emptyFacets = {
  categories: [], collections: [], colors: [], sizes: [],
  price: { min: 0, max: 0 }, promotionCount: 0, inStockCount: 0, newestCount: 0
};
