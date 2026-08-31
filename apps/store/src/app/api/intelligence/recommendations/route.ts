import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { demoProducts } from "../../../../lib/catalog";
import { parseRpcProductList } from "../../../../lib/catalog-result";
import { isAllowedRequestOrigin } from "../../../../lib/http-origin";
import { hasServerConsent } from "../../../../lib/privacy/consent-server";
import {
  createPublicSupabaseClient,
  createServerSupabaseClient
} from "../../../../lib/supabase/server";

const sourceSchema = z.enum([
  "personalized",
  "trending",
  "most_wanted",
  "most_viewed",
  "discovery",
  "newest",
  "price_range",
  "recently_viewed",
  "because_you_viewed"
]);
const inputSchema = z.object({
  source: sourceSchema.default("personalized"),
  sessionId: z.string().uuid().nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  seen: z.array(z.string().uuid()).max(50).default([]),
  recent: z.array(z.string().uuid()).max(20).default([]),
  seed: z.string().max(80).default("curtiz"),
  limit: z.number().int().min(1).max(24).default(8),
  priceMin: z.number().int().nonnegative().nullable().optional(),
  priceMax: z.number().int().positive().nullable().optional()
});

async function recommendationResponse(input: z.infer<typeof inputSchema>, personalized: boolean) {
  if (process.env.DEMO_MODE === "true") {
    const products = demoProducts
      .filter(
        (product) =>
          !input.seen.includes(product.id) &&
          (!input.category || product.category.toLowerCase() === input.category.toLowerCase())
      )
      .slice(0, input.limit);
    return NextResponse.json(
      {
        products,
        source: input.source,
        nextCursor: products.length ? crypto.randomUUID() : null,
        demo: true
      },
      {
        headers: {
          "cache-control": personalized
            ? "private, no-store"
            : "public, s-maxage=120, stale-while-revalidate=600"
        }
      }
    );
  }
  const supabase = personalized ? await createServerSupabaseClient() : createPublicSupabaseClient();
  if (!supabase)
    return NextResponse.json(
      { products: [], message: "Recomendações indisponíveis." },
      { status: 503 }
    );
  const result = await supabase.rpc("get_intelligence_recommendations", {
    p_source: input.source,
    p_session_id: input.sessionId ?? null,
    p_category: input.category ?? null,
    p_seen: input.seen,
    p_seed: input.seed,
    p_limit: input.limit,
    p_price_min: input.priceMin ?? null,
    p_price_max: input.priceMax ?? null,
    p_only: input.source === "recently_viewed" ? input.recent : []
  });
  const products = result.error ? null : parseRpcProductList(result.data);
  if (!products)
    return NextResponse.json(
      { products: [], message: "Recomendações indisponíveis." },
      { status: 503, headers: { "cache-control": "private, no-store" } }
    );
  return NextResponse.json(
    {
      products,
      source: input.source,
      nextCursor: products.length === input.limit ? crypto.randomUUID() : null
    },
    {
      headers: {
        "cache-control": personalized
          ? "private, no-store"
          : "public, s-maxage=120, stale-while-revalidate=600",
        vary: "accept-encoding"
      }
    }
  );
}

export async function GET(request: NextRequest) {
  const parsed = inputSchema.safeParse({
    source: request.nextUrl.searchParams.get("source") ?? undefined,
    category: request.nextUrl.searchParams.get("category"),
    seed: request.nextUrl.searchParams.get("seed") ?? "curtiz",
    limit: Number(request.nextUrl.searchParams.get("limit") ?? 8),
    seen: [],
    recent: []
  });
  if (!parsed.success) return NextResponse.json({ products: [] }, { status: 400 });
  return recommendationResponse(parsed.data, false);
}
export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ products: [] }, { status: 403 });
  if (!hasServerConsent(request, "analytics"))
    return NextResponse.json(
      { products: [], enabled: false },
      { status: 403, headers: { "cache-control": "private, no-store" } }
    );
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ products: [] }, { status: 400 });
  return recommendationResponse(parsed.data, true);
}
