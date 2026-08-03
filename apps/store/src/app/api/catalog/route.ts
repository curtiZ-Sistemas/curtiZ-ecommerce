import { NextResponse } from "next/server";
import { parseCatalogFilters, queryDemoCatalog } from "@/lib/catalog-query";
import { parseCatalogRpcResult } from "@/lib/catalog-result";
import { isPresentationCatalogEnabled } from "@/lib/presentation-catalog";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readQueryResult } from "@/lib/unknown-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fixedCategory = url.searchParams.get("categoria_fixa") ?? undefined;
  const filters = parseCatalogFilters(url.searchParams, fixedCategory);
  if (process.env.DEMO_MODE === "true") {
    return NextResponse.json(queryDemoCatalog(filters), {
      headers: { "cache-control": "private, no-store", "x-catalog-source": "demo" }
    });
  }
  const presentationFallback = isPresentationCatalogEnabled();

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
      p_in_stock: true,
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
        return NextResponse.json(result, {
          headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" }
        });
      }
    }
  }

  if (presentationFallback || process.env.NODE_ENV !== "production") {
    return NextResponse.json(queryDemoCatalog(filters), {
      headers: { "cache-control": "private, no-store", "x-catalog-source": "demo" }
    });
  }

  return NextResponse.json(
    { message: "Não foi possível carregar o catálogo agora." },
    { status: 503, headers: { "cache-control": "no-store" } }
  );
}
