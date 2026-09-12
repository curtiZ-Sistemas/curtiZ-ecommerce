import "server-only";

import { cache } from "react";
import { createPublicSupabaseClient } from "./supabase/server";
import { readQueryResult, readRows, readString } from "./unknown-data";

export type SitemapProduct = { slug: string; updatedAt?: string };

const SITEMAP_PAGE_SIZE = 50_000;

export const getActiveProductSitemapEntries = cache(async (): Promise<SitemapProduct[]> => {
  const supabase = createPublicSupabaseClient();
  if (!supabase) return [];
  const response = await supabase.rpc("get_storefront_product_seo_entries", {
    p_limit: SITEMAP_PAGE_SIZE
  });
  const result = readQueryResult(response);
  if (result.error) return [];

  return readRows(result.data).flatMap((row): SitemapProduct[] => {
    const slug = readString(row, "slug");
    if (!slug) return [];
    const updatedAt = readString(row, "updatedAt");
    return [{ slug, ...(updatedAt ? { updatedAt } : {}) }];
  });
});
