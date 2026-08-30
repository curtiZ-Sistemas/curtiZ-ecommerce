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

export const runtime = "nodejs";

type ImageInfo = { extension: "jpg" | "png" | "webp"; mime: string; width: number; height: number };
const valueText = (value: unknown, key: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : "";
};

const uint16 = (bytes: Uint8Array, offset: number, little = false) =>
  little ? bytes[offset]! | (bytes[offset + 1]! << 8) : (bytes[offset]! << 8) | bytes[offset + 1]!;
const uint24 = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
const uint32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset]! << 24) |
    (bytes[offset + 1]! << 16) |
    (bytes[offset + 2]! << 8) |
    bytes[offset + 3]!) >>>
  0;

function inspectImage(bytes: Uint8Array): ImageInfo | null {
  if (
    bytes.length >= 24 &&
    [0x89, 0x50, 0x4e, 0x47].every((value, index) => bytes[index] === value)
  ) {
    return {
      extension: "png",
      mime: "image/png",
      width: uint32(bytes, 16),
      height: uint32(bytes, 20)
    };
  }
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) {
    const type = new TextDecoder().decode(bytes.slice(12, 16));
    if (type === "VP8X" && bytes.length >= 30)
      return {
        extension: "webp",
        mime: "image/webp",
        width: uint24(bytes, 24) + 1,
        height: uint24(bytes, 27) + 1
      };
    if (type === "VP8L" && bytes.length >= 25)
      return {
        extension: "webp",
        mime: "image/webp",
        width: 1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8),
        height: 1 + (bytes[22]! >> 6) + (bytes[23]! << 2) + ((bytes[24]! & 0x0f) << 10)
      };
    if (type === "VP8 " && bytes.length >= 30)
      return {
        extension: "webp",
        mime: "image/webp",
        width: uint16(bytes, 26, true) & 0x3fff,
        height: uint16(bytes, 28, true) & 0x3fff
      };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      const length = uint16(bytes, offset + 2);
      if (
        new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]).has(
          marker
        )
      ) {
        return {
          extension: "jpg",
          mime: "image/jpeg",
          height: uint16(bytes, offset + 5),
          width: uint16(bytes, offset + 7)
        };
      }
      if (length < 2) break;
      offset += length + 2;
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  if (!safePanelOrigin(request))
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: privateNoStore }
    );
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse();
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 10 * 1024 * 1024 + 65_536)
    return NextResponse.json(
      { message: "Envie uma imagem de até 10 MB." },
      { status: 413, headers: privateNoStore }
    );
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const parsed = z
    .object({
      productId: postgresUuidSchema,
      color: z.string().trim().max(80).optional(),
      alt: z.string().trim().min(3).max(300),
      primary: z.enum(["true", "false"])
    })
    .safeParse({
      productId: form?.get("productId"),
      color: form?.get("color") || undefined,
      alt: form?.get("alt"),
      primary: form?.get("primary")
    });
  if (!parsed.success || !(file instanceof File) || file.size < 1 || file.size > 10 * 1024 * 1024)
    return NextResponse.json(
      { message: "Envie JPG, PNG ou WebP de até 10 MB." },
      { status: 400, headers: privateNoStore }
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = inspectImage(bytes);
  if (!image || image.width < 1 || image.height < 1)
    return NextResponse.json(
      { message: "O arquivo não contém uma imagem válida." },
      { status: 415, headers: privateNoStore }
    );

  const product = await auth.supabase
    .from("products")
    .select("id")
    .eq("id", parsed.data.productId)
    .maybeSingle();
  if (product.error || !product.data)
    return NextResponse.json(
      { message: "Produto não encontrado." },
      { status: 404, headers: privateNoStore }
    );
  let variantId: string | null = null;
  if (parsed.data.color) {
    const variant = await auth.supabase
      .from("product_variants")
      .select("id")
      .eq("product_id", parsed.data.productId)
      .eq("color_name", parsed.data.color)
      .limit(1)
      .maybeSingle();
    if (variant.error || !variant.data)
      return NextResponse.json(
        { message: "A cor selecionada não existe neste produto." },
        { status: 400, headers: privateNoStore }
      );
    variantId = valueText(variant.data, "id") || null;
  }
  const path = `products/${auth.userId}/${parsed.data.productId}/${randomUUID()}.${image.extension}`;
  const uploaded = await auth.supabase.storage
    .from("catalog-public")
    .upload(path, bytes, { contentType: image.mime, cacheControl: "31536000", upsert: false });
  if (uploaded.error)
    return NextResponse.json(
      { message: "Não foi possível armazenar a imagem." },
      { status: 409, headers: privateNoStore }
    );
  if (parsed.data.primary === "true") {
    const reset = await auth.supabase
      .from("product_images")
      .update({ is_primary: false })
      .eq("product_id", parsed.data.productId);
    if (reset.error) {
      await auth.supabase.storage.from("catalog-public").remove([path]);
      return NextResponse.json(
        { message: "Não foi possível definir a imagem principal." },
        { status: 409, headers: privateNoStore }
      );
    }
  }
  const count = await auth.supabase
    .from("product_images")
    .select("id", { count: "exact", head: true })
    .eq("product_id", parsed.data.productId);
  const inserted = await auth.supabase
    .from("product_images")
    .insert({
      product_id: parsed.data.productId,
      variant_id: variantId,
      storage_path: path,
      alt_text: parsed.data.alt,
      sort_order: count.count ?? 0,
      is_primary: parsed.data.primary === "true",
      width: image.width,
      height: image.height
    })
    .select("id")
    .single();
  if (inserted.error) {
    await auth.supabase.storage.from("catalog-public").remove([path]);
    return NextResponse.json(
      { message: "Não foi possível associar a imagem ao produto." },
      { status: 409, headers: privateNoStore }
    );
  }
  return NextResponse.json(
    {
      id: valueText(inserted.data as unknown, "id"),
      path,
      url: auth.supabase.storage.from("catalog-public").getPublicUrl(path).data.publicUrl
    },
    { status: 201, headers: privateNoStore }
  );
}

export async function DELETE(request: NextRequest) {
  if (!safePanelOrigin(request))
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: privateNoStore }
    );
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse();
  const parsed = z
    .object({ imageId: postgresUuidSchema })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { message: "Imagem inválida." },
      { status: 400, headers: privateNoStore }
    );
  const image = await auth.supabase
    .from("product_images")
    .select("id,storage_path")
    .eq("id", parsed.data.imageId)
    .maybeSingle();
  if (image.error || !image.data)
    return NextResponse.json(
      { message: "Imagem não encontrada." },
      { status: 404, headers: privateNoStore }
    );
  const removedRow = await auth.supabase
    .from("product_images")
    .delete()
    .eq("id", parsed.data.imageId);
  if (removedRow.error)
    return NextResponse.json(
      { message: "A imagem não pôde ser removida." },
      { status: 409, headers: privateNoStore }
    );
  const storagePath = valueText(image.data, "storage_path");
  const removedFile = storagePath
    ? await auth.supabase.storage.from("catalog-public").remove([storagePath])
    : { error: null };
  if (removedFile.error)
    console.error("[product-media-api] orphaned object", {
      requestId: crypto.randomUUID(),
      code: removedFile.error.message.slice(0, 120)
    });
  return NextResponse.json({ ok: true, message: "Imagem removida." }, { headers: privateNoStore });
}

export async function PATCH(request: NextRequest) {
  if (!safePanelOrigin(request))
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: privateNoStore }
    );
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse();
  const parsed = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("primary"), imageId: postgresUuidSchema }),
      z.object({
        action: z.literal("move"),
        imageId: postgresUuidSchema,
        direction: z.enum(["before", "after"])
      }),
      z.object({
        action: z.literal("reorder"),
        imageId: postgresUuidSchema,
        targetImageId: postgresUuidSchema
      }),
      z.object({
        action: z.literal("alt"),
        imageId: postgresUuidSchema,
        alt: z.string().trim().min(3).max(300)
      }),
      z.object({
        action: z.literal("associate"),
        variantId: postgresUuidSchema,
        imageId: postgresUuidSchema.nullable()
      })
    ])
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { message: "Ação de mídia inválida." },
      { status: 400, headers: privateNoStore }
    );

  if (parsed.data.action === "associate") {
    const variant = await auth.supabase
      .from("product_variants")
      .select("id,product_id,color_name")
      .eq("id", parsed.data.variantId)
      .maybeSingle();
    if (variant.error || !variant.data)
      return NextResponse.json(
        { message: "Cor do produto não encontrada." },
        { status: 404, headers: privateNoStore }
      );

    const group = await auth.supabase
      .from("product_variants")
      .select("id")
      .eq("product_id", variant.data.product_id)
      .eq("color_name", variant.data.color_name);
    if (group.error || !group.data?.length)
      return NextResponse.json(
        { message: "Não foi possível identificar as variações desta cor." },
        { status: 409, headers: privateNoStore }
      );

    const variantIds = group.data.map((item) => valueText(item, "id")).filter(Boolean);
    if (parsed.data.imageId) {
      const image = await auth.supabase
        .from("product_images")
        .select("id,product_id")
        .eq("id", parsed.data.imageId)
        .maybeSingle();
      if (image.error || !image.data || image.data.product_id !== variant.data.product_id)
        return NextResponse.json(
          { message: "A imagem selecionada não pertence a este produto." },
          { status: 400, headers: privateNoStore }
        );

      const associated = await auth.supabase
        .from("product_images")
        .update({ variant_id: variant.data.id })
        .eq("id", image.data.id);
      if (associated.error)
        return NextResponse.json(
          { message: "Não foi possível associar a imagem à cor." },
          { status: 409, headers: privateNoStore }
        );

      const cleared = await auth.supabase
        .from("product_images")
        .update({ variant_id: null })
        .in("variant_id", variantIds)
        .neq("id", image.data.id);
      if (cleared.error)
        return NextResponse.json(
          {
            message:
              "A imagem foi selecionada, mas associações anteriores não puderam ser removidas."
          },
          { status: 409, headers: privateNoStore }
        );
    } else {
      const cleared = await auth.supabase
        .from("product_images")
        .update({ variant_id: null })
        .in("variant_id", variantIds);
      if (cleared.error)
        return NextResponse.json(
          { message: "Não foi possível remover a imagem desta cor." },
          { status: 409, headers: privateNoStore }
        );
    }

    return NextResponse.json(
      { ok: true, message: "Imagem da cor atualizada." },
      { headers: privateNoStore }
    );
  }

  const selected = await auth.supabase
    .from("product_images")
    .select("id,product_id,sort_order")
    .eq("id", parsed.data.imageId)
    .maybeSingle();
  if (selected.error || !selected.data)
    return NextResponse.json(
      { message: "Imagem não encontrada." },
      { status: 404, headers: privateNoStore }
    );
  const selectedImage = selected.data;
  if (parsed.data.action === "primary") {
    const reset = await auth.supabase
      .from("product_images")
      .update({ is_primary: false })
      .eq("product_id", selectedImage.product_id);
    const updated = reset.error
      ? reset
      : await auth.supabase
          .from("product_images")
          .update({ is_primary: true })
          .eq("id", selectedImage.id);
    if (updated.error)
      return NextResponse.json(
        { message: "Não foi possível definir a imagem principal." },
        { status: 409, headers: privateNoStore }
      );
    return NextResponse.json(
      { ok: true, message: "Imagem principal atualizada." },
      { headers: privateNoStore }
    );
  }
  if (parsed.data.action === "alt") {
    const updated = await auth.supabase
      .from("product_images")
      .update({ alt_text: parsed.data.alt })
      .eq("id", selectedImage.id);
    if (updated.error)
      return NextResponse.json(
        { message: "Não foi possível atualizar o texto alternativo." },
        { status: 409, headers: privateNoStore }
      );
    return NextResponse.json(
      { ok: true, message: "Texto alternativo atualizado." },
      { headers: privateNoStore }
    );
  }
  const images = await auth.supabase
    .from("product_images")
    .select("id,sort_order")
    .eq("product_id", selectedImage.product_id)
    .order("sort_order");
  if (images.error)
    return NextResponse.json(
      { message: "Não foi possível reordenar as imagens." },
      { status: 409, headers: privateNoStore }
    );
  const ordered = images.data ?? [];
  const index = ordered.findIndex((image) => image.id === selectedImage.id);
  let target: (typeof ordered)[number] | undefined;
  if (parsed.data.action === "reorder") {
    const targetImageId = parsed.data.targetImageId;
    target = ordered.find((image) => image.id === targetImageId);
  } else {
    target = ordered[parsed.data.direction === "before" ? index - 1 : index + 1];
  }
  if (index < 0 || !target)
    return NextResponse.json(
      { ok: true, message: "A imagem já está no limite da galeria." },
      { headers: privateNoStore }
    );
  const first = await auth.supabase
    .from("product_images")
    .update({ sort_order: target.sort_order })
    .eq("id", selectedImage.id);
  const second = first.error
    ? first
    : await auth.supabase
        .from("product_images")
        .update({ sort_order: selectedImage.sort_order })
        .eq("id", target.id);
  if (second.error)
    return NextResponse.json(
      { message: "Não foi possível reordenar as imagens." },
      { status: 409, headers: privateNoStore }
    );
  return NextResponse.json(
    { ok: true, message: "Ordem das imagens atualizada." },
    { headers: privateNoStore }
  );
}
