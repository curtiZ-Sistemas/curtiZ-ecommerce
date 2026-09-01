import { NextResponse } from "next/server";
import { buildGoogleMerchantFeed } from "@/lib/google-merchant";
import { createPublicSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const feedHeaders = {
  "content-type": "application/rss+xml; charset=utf-8",
  "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, follow"
};

export async function GET() {
  const requestId = crypto.randomUUID();
  const supabase = createPublicSupabaseClient();
  if (!supabase) {
    console.error("[google-merchant-feed] unavailable", { requestId, code: "missing_public_client" });
    return new NextResponse("Feed temporariamente indisponível.", {
      status: 503,
      headers: { "cache-control": "private, no-store", "x-request-id": requestId }
    });
  }

  const response = await supabase.rpc("get_google_merchant_feed");
  if (response.error) {
    console.error("[google-merchant-feed] query failed", {
      requestId,
      code: response.error.code ?? "unknown"
    });
    return new NextResponse("Feed temporariamente indisponível.", {
      status: 503,
      headers: { "cache-control": "private, no-store", "x-request-id": requestId }
    });
  }

  const result = buildGoogleMerchantFeed(response.data);
  console.info("[google-merchant-feed] generated", {
    requestId,
    eligible: result.eligible,
    rejected: result.rejected,
    rejectionCounts: result.rejectionCounts
  });

  return new NextResponse(result.xml, {
    status: 200,
    headers: {
      ...feedHeaders,
      "x-request-id": requestId,
      "x-merchant-items": String(result.eligible)
    }
  });
}
