import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRequestOrigin } from "../../../../lib/http-origin";
import { hasServerConsent } from "../../../../lib/privacy/consent-server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
const eventTypes = [
  "page_view",
  "product_impression",
  "product_view",
  "image_interaction",
  "variant_select",
  "category_view",
  "search",
  "search_no_results",
  "search_result_click",
  "recommendation_impression",
  "recommendation_click",
  "favorite_add",
  "favorite_remove",
  "cart_add",
  "cart_remove",
  "checkout_start"
] as const;
const eventSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(eventTypes),
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  query: z.string().trim().max(120).optional(),
  resultCount: z.number().int().min(0).max(10000).optional(),
  source: z.string().trim().max(40).optional(),
  path: z.string().max(200).optional(),
  occurredAt: z.string().datetime(),
  device: z.enum(["mobile", "tablet", "desktop"])
});
const batchSchema = z.object({
  sessionId: z.string().uuid(),
  consent: z.literal(true),
  events: z.array(eventSchema).min(1).max(20)
});

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ accepted: 0 }, { status: 403 });
  if (!hasServerConsent(request, "analytics"))
    return NextResponse.json(
      { accepted: 0, enabled: false },
      { status: 403, headers: { "cache-control": "private, no-store" } }
    );
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > 32_768) return NextResponse.json({ accepted: 0 }, { status: 413 });
  const parsed = batchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { accepted: 0 },
      { status: 400, headers: { "cache-control": "private, no-store" } }
    );
  if (process.env.DEMO_MODE === "true")
    return NextResponse.json(
      { accepted: parsed.data.events.length, demo: true },
      { status: 202, headers: { "cache-control": "private, no-store" } }
    );
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ accepted: 0 }, { status: 503 });
  const result = await supabase.rpc("ingest_intelligence_events", {
    p_session_id: parsed.data.sessionId,
    p_events: parsed.data.events,
    p_consent: true
  });
  if (result.error)
    return NextResponse.json(
      { accepted: 0 },
      {
        status: result.error.message.includes("rate limit") ? 429 : 503,
        headers: { "cache-control": "private, no-store" }
      }
    );
  return NextResponse.json(result.data, {
    status: 202,
    headers: { "cache-control": "private, no-store" }
  });
}

export async function DELETE(request: NextRequest) {
  if (!isAllowedRequestOrigin(request))
    return NextResponse.json({ forgotten: false }, { status: 403 });
  const parsed = z
    .object({ sessionId: z.string().uuid() })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ forgotten: false }, { status: 400 });
  if (process.env.DEMO_MODE === "true")
    return NextResponse.json(
      { forgotten: true },
      { headers: { "cache-control": "private, no-store" } }
    );
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ forgotten: false }, { status: 503 });
  const result = await supabase.rpc("forget_intelligence_session", {
    p_session_id: parsed.data.sessionId
  });
  return NextResponse.json(
    { forgotten: !result.error },
    { status: result.error ? 503 : 200, headers: { "cache-control": "private, no-store" } }
  );
}
