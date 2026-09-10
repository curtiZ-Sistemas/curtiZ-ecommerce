import { NextResponse } from "next/server";
import { z } from "zod";
import { createPublicSupabaseClient } from "@/lib/supabase/server";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { demoProducts } from "@/lib/catalog";

const headers = { "cache-control": "no-store" };
export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({}, { status: 403, headers });
  const parsed = z.object({ variantIds: z.array(z.string().min(1).max(180)).max(50) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({}, { status: 400, headers });
  if (process.env.DEMO_MODE === "true") return NextResponse.json({ items: parsed.data.variantIds.map((variantId) => ({
    variantId, available: demoProducts.some((product) => product.colors.some((color) => product.sizes.some((size) => `${product.id}:${color}:${size}` === variantId)))
  })) }, { headers });
  const ids = z.array(z.string().uuid()).safeParse(parsed.data.variantIds);
  if (!ids.success) return NextResponse.json({}, { status: 400, headers });
  const supabase = createPublicSupabaseClient();
  if (!supabase) return NextResponse.json({}, { status: 503, headers });
  const result = await supabase.rpc("cart_variant_availability", { p_variant_ids: ids.data });
  if (result.error) return NextResponse.json({}, { status: 503, headers });
  const items: unknown = result.data;
  return NextResponse.json({ items }, { headers });
}
