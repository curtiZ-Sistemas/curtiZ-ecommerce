import { NextResponse } from "next/server";
import { buildProductImageSitemap } from "../../lib/image-sitemap";
import { getActiveProductImageSitemapEntries } from "../../lib/seo-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await getActiveProductImageSitemapEntries();
  if (!entries) {
    return new NextResponse("Image sitemap temporarily unavailable", {
      status: 503,
      headers: { "cache-control": "private, no-store", "content-type": "text/plain; charset=utf-8" }
    });
  }
  const xml = buildProductImageSitemap(entries);
  return new NextResponse(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
      "x-content-type-options": "nosniff"
    }
  });
}
