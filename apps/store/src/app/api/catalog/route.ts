import { NextResponse } from "next/server";
import { normalizeProductColorName } from "@curtiz/domain";
import { parseCatalogFilters, queryDemoCatalog } from "@/lib/catalog-query";
import { parseCatalogRpcResult } from "@/lib/catalog-result";
import { isPresentationCatalogEnabled } from "@/lib/presentation-catalog";
import { storefrontFreshnessHeaders } from "@/lib/storefront-cache";
import { createPublicSupabaseClient } from "@/lib/supabase/server";
import { readQueryResult, readRows, readString } from "@/lib/unknown-data";

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
      p_featured: false,
      p_min_rating: filters.minRating ?? null,
      p_sort: filters.newest ? "newest" : filters.sort,
      p_page: filters.page,
      p_page_size: suggestions ? Math.min(filters.pageSize, 8) : filters.pageSize
    });
    const { data, error } = readQueryResult(rpcResponse);
    if (!error) {
      const result = parseCatalogRpcResult(data, {
        page: filters.page,
        pageSize: filters.pageSize,
        sort: filters.sort
      });
      if (result) {
        if (compact || !result.facets.colors.length) {
          return NextResponse.json(compact ? { products: result.products } : result, {
            headers: storefrontFreshnessHeaders
          });
        }
        const colorResponse = await supabase
          .from("product_variants")
          .select("color_name,color_hex_secondary,updated_at")
          .in("color_name", result.facets.colors.map((option) => option.value))
          .eq("active", true)
          .order("updated_at", { ascending: false })
          .limit(500);
        const secondaryByName = new Map<string, string>();
        if (!colorResponse.error) {
          for (const row of readRows(colorResponse.data)) {
            const key = normalizeProductColorName(readString(row, "color_name"));
            const secondary = readString(row, "color_hex_secondary");
            if (key && secondary && !secondaryByName.has(key)) secondaryByName.set(key, secondary);
          }
        }
        const enrichedResult = secondaryByName.size
          ? {
              ...result,
              facets: {
                ...result.facets,
                colors: result.facets.colors.map((option) => ({
                  ...option,
                  ...(secondaryByName.get(normalizeProductColorName(option.value))
                    ? { secondaryHex: secondaryByName.get(normalizeProductColorName(option.value)) }
                    : {})
                }))
              }
            }
          : result;
        return NextResponse.json(enrichedResult, {
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
