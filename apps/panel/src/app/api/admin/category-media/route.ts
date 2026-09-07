import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeAdminRequest,
  privateNoStore,
  safePanelOrigin,
  unauthorizedAdminResponse
} from "@/lib/admin-api";

export const runtime = "nodejs";

const maxSize = 10 * 1024 * 1024;

function inspectImage(bytes: Uint8Array): { extension: "jpg" | "png" | "webp"; mime: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: "jpg", mime: "image/jpeg" };
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value
    )
  ) {
    return { extension: "png", mime: "image/png" };
  }
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) {
    return { extension: "webp", mime: "image/webp" };
  }
  return null;
}

async function authorize(request: NextRequest) {
  const auth = await authorizeAdminRequest(request, ["admin"]);
  if (!auth) return null;
  const permission = await auth.supabase.rpc("has_permission", {
    permission_code: "catalog.taxonomy.manage"
  });
  return !permission.error && permission.data === true ? auth : null;
}

export async function POST(request: NextRequest) {
  if (!safePanelOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: privateNoStore }
    );
  }
  const auth = await authorize(request);
  if (!auth) return unauthorizedAdminResponse();
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxSize + 65_536) {
    return NextResponse.json(
      { message: "Envie uma imagem de até 10 MB." },
      { status: 413, headers: privateNoStore }
    );
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > maxSize) {
    return NextResponse.json(
      { message: "Envie uma imagem JPG, PNG ou WebP de até 10 MB." },
      { status: 400, headers: privateNoStore }
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspectImage(bytes);
  if (!inspected) {
    return NextResponse.json(
      { message: "O conteúdo do arquivo não corresponde a uma imagem permitida." },
      { status: 415, headers: privateNoStore }
    );
  }
  const path = `categories/${auth.userId}/${randomUUID()}.${inspected.extension}`;
  const uploaded = await auth.supabase.storage.from("catalog-public").upload(path, bytes, {
    contentType: inspected.mime,
    cacheControl: "31536000",
    upsert: false
  });
  if (uploaded.error) {
    return NextResponse.json(
      { message: "Não foi possível armazenar a imagem da categoria." },
      { status: 409, headers: privateNoStore }
    );
  }
  const publicUrl = auth.supabase.storage.from("catalog-public").getPublicUrl(path).data.publicUrl;
  return NextResponse.json({ path, publicUrl }, { status: 201, headers: privateNoStore });
}

export async function DELETE(request: NextRequest) {
  if (!safePanelOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: privateNoStore }
    );
  }
  const auth = await authorize(request);
  if (!auth) return unauthorizedAdminResponse();
  const parsed = z
    .object({ path: z.string().trim().max(500) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parsed.data.path.startsWith("categories/") || parsed.data.path.includes("..")) {
    return NextResponse.json(
      { message: "Arquivo inválido." },
      { status: 400, headers: privateNoStore }
    );
  }
  const referenced = await auth.supabase
    .from("categories")
    .select("id")
    .eq("image_path", parsed.data.path)
    .limit(1)
    .maybeSingle();
  if (referenced.data) {
    return NextResponse.json(
      { message: "A imagem ainda está vinculada a uma categoria." },
      { status: 409, headers: privateNoStore }
    );
  }
  const removed = await auth.supabase.storage.from("catalog-public").remove([parsed.data.path]);
  if (removed.error) {
    return NextResponse.json(
      { message: "Não foi possível remover a imagem." },
      { status: 409, headers: privateNoStore }
    );
  }
  return NextResponse.json({ message: "Imagem removida." }, { headers: privateNoStore });
}
