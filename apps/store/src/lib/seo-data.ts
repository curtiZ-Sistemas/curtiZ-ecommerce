import "server-only";

import { cache } from "react";
import { demoProducts } from "./catalog";
import { createPublicSupabaseClient } from "./supabase/server";
import { readQueryResult, readRows, readString } from "./unknown-data";

export type SitemapProduct = { slug: string; updatedAt?: string };

const SITEMAP_PAGE_SIZE = 500;

export const getActiveProductSitemapEntries = cache(async (): Promise<SitemapProduct[]> => {
  if (process.env.DEMO_MODE === "true") {
    return demoProducts.map((product) => ({ slug: product.slug }));
  }

  const supabase = createPublicSupabaseClient();
  if (!supabase) return [];

  const products: SitemapProduct[] = [];
  let offset = 0;

  while (true) {
    const response = await supabase
      .from("products")
      .select("slug,updated_at")
      .eq("status", "active")
      .order("slug")
      .range(offset, offset + SITEMAP_PAGE_SIZE - 1);
    const result = readQueryResult(response);
    if (result.error) return [];

    const rows = readRows(result.data);
    for (const row of rows) {
      const slug = readString(row, "slug");
      if (!slug) continue;
      const updatedAt = readString(row, "updated_at");
      products.push({ slug, ...(updatedAt ? { updatedAt } : {}) });
    }

    if (rows.length < SITEMAP_PAGE_SIZE) break;
    offset += SITEMAP_PAGE_SIZE;
  }

  return products;
});
