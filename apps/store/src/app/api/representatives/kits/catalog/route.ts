import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { commercialKitCheckoutConfigured } from "@/lib/representative-commercial-payments";
import { getStoreRuntimeEnvironment } from "@/lib/runtime-environment";
import { publicProductImageUrl } from "@/lib/product-image-seo";
import { isUnknownRecord } from "@/lib/unknown-data";

const headers = { "cache-control": "private, no-store" };
export async function GET(request: NextRequest) {
  const offset = z.coerce.number().int().min(0).max(10000).safeParse(request.nextUrl.searchParams.get("offset") ?? 0);
  const query = z.string().trim().max(80).safeParse(request.nextUrl.searchParams.get("q") ?? "");
  const color = z.string().trim().max(80).safeParse(request.nextUrl.searchParams.get("color") ?? "");
  const size = z.string().trim().max(40).safeParse(request.nextUrl.searchParams.get("size") ?? "");
  const available = z.enum(["true", "false"]).safeParse(request.nextUrl.searchParams.get("available") ?? "false");
  if (!offset.success || !query.success || !color.success || !size.success || !available.success) {
    return NextResponse.json({ message: "Revise os filtros do catálogo." }, { status: 400, headers });
  }
  const db = await createServerSupabaseClient();
  const auth = db ? await db.auth.getUser() : null;
  if (!db || auth?.error || !auth?.data.user) return NextResponse.json({ message: "Acesso negado." }, { status: 401, headers });
  const result = await db.rpc("list_representative_catalog_kit_groups", {
    p_offset: offset.data, p_query: query.data, p_color: color.data, p_size: size.data, p_available: available.data === "true"
  });
  if (result.error) return NextResponse.json({ message: "Não foi possível carregar os kits. Tente novamente." }, { status: 503, headers });
  if (!result.data) return NextResponse.json({ message: "Acesso de representante indisponível." }, { status: 403, headers });
  if (!isUnknownRecord(result.data) || !Array.isArray(result.data.items)
    || !result.data.items.every((item: unknown) => isUnknownRecord(item) && Array.isArray(item.variants)
      && item.variants.every(isUnknownRecord))) {
    return NextResponse.json({ message: "Não foi possível carregar os kits. Tente novamente." }, { status: 503, headers });
  }
  const items = result.data.items.map((item: unknown) => {
    if (!isUnknownRecord(item)) return item;
    return { ...item, variants: (item.variants as unknown[]).map((variant: unknown) => {
      if (!isUnknownRecord(variant)) return variant;
      const imagePath = variant.imagePath;
      const saved = Object.fromEntries(Object.entries(variant).filter(([key]) => key !== "imagePath" && key !== "sku"));
      return {
        ...saved,
        imageUrl: typeof imagePath === "string" ? publicProductImageUrl(imagePath) : "",
        imageAlt: typeof variant.imageAlt === "string" ? variant.imageAlt : ""
      };
    }) };
  });
  const environment = getStoreRuntimeEnvironment();
  const page = { ...result.data, items };
  if (environment.REPRESENTATIVE_KIT_MP_COLLECTOR_ID) {
    return NextResponse.json({ ...page, orderHistoryAvailable: true,
      checkoutConfigured: commercialKitCheckoutConfigured(environment) }, { headers });
  }
  return NextResponse.json(page, { headers });
}
