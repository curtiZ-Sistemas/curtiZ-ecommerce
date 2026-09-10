import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readNumber, readQueryResult, readString } from "@/lib/unknown-data";

const schema = z.object({
  code: z.string().trim().min(1).max(40),
  postalCode: z.string().trim().max(9).default(""),
  lines: z.array(z.object({
    productId: z.string().uuid(),
    variantId: z.string().uuid(),
    quantity: z.number().int().min(1).max(10)
  })).min(1).max(50)
});

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ ok: false, message: "Origem não permitida." }, { status: 403 });
  }
  const supabase = await createServerSupabaseClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!supabase || !user) {
    return NextResponse.json({ ok: false, message: "Entre na sua conta para aplicar o cupom." }, { status: 401 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Informe um cupom válido." }, { status: 400 });
  }
  const result = readQueryResult(await supabase.rpc("preview_checkout_coupon", {
    p_code: parsed.data.code,
    p_postal_code: parsed.data.postalCode,
    p_lines: parsed.data.lines.map((line) => ({
      product_id: line.productId,
      variant_id: line.variantId,
      quantity: line.quantity
    }))
  }) as unknown);
  if (result.error || !isUnknownRecord(result.data)) {
    return NextResponse.json({ ok: false, message: "Este cupom não é válido para este pedido." }, { status: 409 });
  }
  return NextResponse.json({
    ok: true,
    name: readString(result.data, "name"),
    discountInCents: Math.round(readNumber(result.data, "discountInCents"))
  }, { headers: { "cache-control": "private, no-store" } });
}
