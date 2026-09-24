import "server-only";

import { logServerEvent } from "@curtiz/security";
import { cache } from "react";
import { createPublicSupabaseClient } from "./supabase/server";
import { isUnknownRecord, readNumber, readQueryResult, readRows, readString } from "./unknown-data";
import { productImageAlt, publicProductImageUrl } from "./product-image-seo";

export type SitemapProduct = { slug: string; updatedAt?: string };
export type SitemapProductImageEntry = {
  slug: string;
  updatedAt?: string;
  images: Array<{ url: string; alt?: string }>;
};

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

export const getActiveProductImageSitemapEntries = cache(async (): Promise<SitemapProductImageEntry[] | null> => {
  const supabase = createPublicSupabaseClient();
  if (!supabase) {
    logServerEvent("error", "storefront_product_image_sitemap_unavailable", { code: "missing_public_client" });
    return null;
  }
  const response = await supabase.rpc("get_storefront_product_image_seo_entries", {
    p_limit: SITEMAP_PAGE_SIZE
  });
  const result = readQueryResult(response);
  if (result.error) {
    const code = isUnknownRecord(result.error) ? readString(result.error, "code", "unknown") : "unknown";
    logServerEvent("error", "storefront_product_image_sitemap_query_failed", { code });
    return null;
  }

  return readRows(result.data).flatMap((row): SitemapProductImageEntry[] => {
    const slug = readString(row, "slug");
    if (!slug) return [];
    const seen = new Set<string>();
    const images = readRows(row.images).flatMap((image) => {
      const mediaType = readString(image, "media_type");
      if (mediaType && mediaType !== "image") return [];
      if (readNumber(image, "width") <= 0 || readNumber(image, "height") <= 0) return [];
      const path = readString(image, "path");
      const url = path ? publicProductImageUrl(path) : "";
      if (!url || seen.has(url)) return [];
      seen.add(url);
      const alt = readString(image, "alt_text");
      return [{ url, alt: productImageAlt(readString(row, "name", slug), alt) }];
    });
    if (!images.length) return [];
    const updatedAt = readString(row, "updatedAt");
    return [{ slug, ...(updatedAt ? { updatedAt } : {}), images }];
  });
});
