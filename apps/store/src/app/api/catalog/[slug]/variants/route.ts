import { NextResponse } from "next/server";
import { getPublicProduct } from "@/lib/storefront-data";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const detail = await getPublicProduct(slug);
  if (!detail) {
    return NextResponse.json(
      { message: "Produto não encontrado." },
      { status: 404, headers: { "cache-control": "no-store" } }
    );
  }

  return NextResponse.json(
    {
      variants: detail.variants.map((variant) => ({
        id: variant.id,
        color: variant.color,
        size: variant.size,
        stock: variant.stock,
        priceInCents: variant.priceInCents,
        ...(variant.image ? { image: variant.image } : {})
      }))
    },
    { headers: { "cache-control": "no-store" } }
  );
}
