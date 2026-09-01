import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeAdminRequest,
  privateNoStore,
  safePanelOrigin,
  unauthorizedAdminResponse
} from "@/lib/admin-api";
import { postgresUuidSchema } from "@/lib/postgres-uuid";
import {
  hasProductVideoSignature,
  MAX_PRODUCT_VIDEO_BYTES,
  productVideoExtension
} from "@/lib/product-video";

export const runtime = "nodejs";

const prepareSchema = z.object({
  action: z.literal("prepare"),
  productId: postgresUuidSchema,
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.enum(["video/mp4", "video/webm"]),
  sizeBytes: z.number().int().min(1).max(MAX_PRODUCT_VIDEO_BYTES)
});

const finalizeSchema = z.object({
  action: z.literal("finalize"),
  productId: postgresUuidSchema,
  path: z.string().trim().regex(/^products\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\.(?:mp4|webm)$/iu),
  mimeType: z.enum(["video/mp4", "video/webm"]),
  sizeBytes: z.number().int().min(1).max(MAX_PRODUCT_VIDEO_BYTES),
  alt: z.string().trim().min(3).max(300),
  posterImageId: postgresUuidSchema,
  variantId: postgresUuidSchema.nullable().optional()
});

export async function POST(request: NextRequest) {
  if (!safePanelOrigin(request)) {
    return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: privateNoStore });
  }
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse();
  const payload: unknown = await request.json().catch(() => null);
  const prepared = prepareSchema.safeParse(payload);
  const finalized = finalizeSchema.safeParse(payload);

  if (prepared.success) {
    const expectedExtension = productVideoExtension[prepared.data.mimeType];
    if (!prepared.data.fileName.toLowerCase().endsWith(`.${expectedExtension}`)) {
      return NextResponse.json({ message: "A extensão não corresponde ao formato do vídeo." }, { status: 400, headers: privateNoStore });
    }
    const product = await auth.supabase.from("products").select("id").eq("id", prepared.data.productId).maybeSingle();
    if (product.error || !product.data) {
      return NextResponse.json({ message: "Produto não encontrado." }, { status: 404, headers: privateNoStore });
    }
    const path = `products/${auth.userId}/${prepared.data.productId}/${randomUUID()}.${expectedExtension}`;
    const signed = await auth.supabase.storage.from("catalog-public").createSignedUploadUrl(path);
    if (signed.error || !signed.data) {
      return NextResponse.json({ message: "Não foi possível preparar o envio direto." }, { status: 409, headers: privateNoStore });
    }
    return NextResponse.json({ path, signedUrl: signed.data.signedUrl }, { headers: privateNoStore });
  }

  if (!finalized.success) {
    return NextResponse.json({ message: "Dados do vídeo inválidos." }, { status: 400, headers: privateNoStore });
  }
  const data = finalized.data;
  if (!data.path.includes(`/${auth.userId}/${data.productId}/`) || !data.path.endsWith(`.${productVideoExtension[data.mimeType]}`)) {
    return NextResponse.json({ message: "Caminho de upload inválido." }, { status: 400, headers: privateNoStore });
  }
  const [poster, variant, count] = await Promise.all([
    auth.supabase.from("product_media").select("id,product_id,storage_path,media_type").eq("id", data.posterImageId).maybeSingle(),
    data.variantId
      ? auth.supabase.from("product_variants").select("id,product_id").eq("id", data.variantId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    auth.supabase.from("product_media").select("id", { count: "exact", head: true }).eq("product_id", data.productId)
  ]);
  if (poster.error || !poster.data || poster.data.product_id !== data.productId || poster.data.media_type !== "image") {
    return NextResponse.json({ message: "Escolha uma imagem válida do produto como poster." }, { status: 400, headers: privateNoStore });
  }
  if (data.variantId && (variant.error || !variant.data || variant.data.product_id !== data.productId)) {
    return NextResponse.json({ message: "A variação não pertence ao produto." }, { status: 400, headers: privateNoStore });
  }
  const publicUrl = auth.supabase.storage.from("catalog-public").getPublicUrl(data.path).data.publicUrl;
  const head = await fetch(publicUrl, { headers: { Range: "bytes=0-4095", "Cache-Control": "no-cache" } }).catch(() => null);
  const contentLength = Number(head?.headers.get("content-range")?.split("/").at(-1) ?? head?.headers.get("content-length") ?? 0);
  const bytes = head?.ok ? new Uint8Array(await head.arrayBuffer()) : new Uint8Array();
  if (!head?.ok || !hasProductVideoSignature(bytes, data.mimeType) || !Number.isFinite(contentLength) || contentLength < 1 || contentLength > MAX_PRODUCT_VIDEO_BYTES || Math.abs(contentLength - data.sizeBytes) > 16) {
    await auth.supabase.storage.from("catalog-public").remove([data.path]);
    return NextResponse.json({ message: "O arquivo enviado não é um vídeo válido ou excede 80 MB." }, { status: 415, headers: privateNoStore });
  }
  const inserted = await auth.supabase.from("product_media").insert({
    product_id: data.productId,
    variant_id: data.variantId ?? null,
    media_type: "video",
    storage_path: data.path,
    thumbnail_path: poster.data.storage_path,
    alt_text: data.alt,
    mime_type: data.mimeType,
    size_bytes: contentLength,
    sort_order: count.count ?? 0,
    is_primary: false,
    created_by: auth.userId
  }).select("id").single();
  if (inserted.error) {
    await auth.supabase.storage.from("catalog-public").remove([data.path]);
    return NextResponse.json({ message: "Não foi possível associar o vídeo à galeria." }, { status: 409, headers: privateNoStore });
  }
  const insertedData: unknown = inserted.data;
  const insertedId = insertedData && typeof insertedData === "object" && !Array.isArray(insertedData)
    ? (insertedData as Record<string, unknown>).id
    : undefined;
  return NextResponse.json({ id: insertedId, url: publicUrl }, { status: 201, headers: privateNoStore });
}
