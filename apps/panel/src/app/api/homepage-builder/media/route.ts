import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { privateNoStore, safePanelOrigin, unauthorizedAdminResponse } from "@/lib/admin-api";
import { authorizeHomepageRequest } from "@/lib/homepage-api";

export const runtime = "nodejs";

type Inspected = {
  extension: "jpg" | "png" | "webp" | "mp4" | "webm";
  mime: "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "video/webm";
  kind: "image" | "video";
};

function inspect(bytes: Uint8Array): Inspected | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { extension: "jpg", mime: "image/jpeg", kind: "image" };
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value))
    return { extension: "png", mime: "image/png", kind: "image" };
  const decoder = new TextDecoder();
  if (bytes.length >= 12 && decoder.decode(bytes.slice(0, 4)) === "RIFF" && decoder.decode(bytes.slice(8, 12)) === "WEBP")
    return { extension: "webp", mime: "image/webp", kind: "image" };
  if (bytes.length >= 12 && decoder.decode(bytes.slice(4, 8)) === "ftyp")
    return { extension: "mp4", mime: "video/mp4", kind: "video" };
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return { extension: "webm", mime: "video/webm", kind: "video" };
  return null;
}

export async function POST(request: NextRequest) {
  if (!safePanelOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: privateNoStore });
  const auth = await authorizeHomepageRequest(request, "homepage.media.manage");
  if (!auth) return unauthorizedAdminResponse();
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 52_428_800 + 65_536)
    return NextResponse.json({ message: "A requisição excede o limite de 50 MB." }, { status: 413, headers: privateNoStore });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const roleValue = form?.get("role");
  const role = typeof roleValue === "string" ? roleValue : "desktop";
  if (!(file instanceof File) || !["desktop", "tablet", "mobile", "video", "background", "thumbnail"].includes(role) || file.size < 1 || file.size > 52_428_800) {
    return NextResponse.json({ message: "Envie JPG, PNG ou WebP até 10 MB, ou MP4/WebM até 50 MB." }, { status: 400, headers: privateNoStore });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspect(bytes);
  if (!inspected || (inspected.kind === "image" && file.size > 10_485_760) || (role === "video") !== (inspected.kind === "video")) {
    return NextResponse.json({ message: "O conteúdo do arquivo não corresponde ao formato e função selecionados." }, { status: 415, headers: privateNoStore });
  }
  const folder = inspected.kind === "video" ? "home-section-videos" : role === "mobile" ? "home-section-mobile-images" : role === "thumbnail" ? "home-section-thumbnails" : "home-section-images";
  const path = `${folder}/${auth.userId}/${role}-${randomUUID()}.${inspected.extension}`;
  const uploaded = await auth.supabase.storage.from("homepage-public").upload(path, bytes, { contentType: inspected.mime, cacheControl: "31536000", upsert: false });
  if (uploaded.error) return NextResponse.json({ message: "Não foi possível armazenar a mídia." }, { status: 409, headers: privateNoStore });
  const publicUrl = auth.supabase.storage.from("homepage-public").getPublicUrl(path).data.publicUrl;
  return NextResponse.json({ path, publicUrl, mimeType: inspected.mime, sizeBytes: file.size, role }, { status: 201, headers: privateNoStore });
}

export async function DELETE(request: NextRequest) {
  if (!safePanelOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: privateNoStore });
  const auth = await authorizeHomepageRequest(request, "homepage.media.manage");
  if (!auth) return unauthorizedAdminResponse();
  const parsed = z.object({ path: z.string().trim().max(500) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.path.includes("..") || !parsed.data.path.includes(`/${auth.userId}/`)) {
    return NextResponse.json({ message: "Arquivo inválido." }, { status: 400, headers: privateNoStore });
  }
  const result = await auth.supabase.storage.from("homepage-public").remove([parsed.data.path]);
  if (result.error) return NextResponse.json({ message: "O arquivo está em uso ou não pôde ser removido." }, { status: 409, headers: privateNoStore });
  return NextResponse.json({ message: "Upload órfão removido." }, { headers: privateNoStore });
}
