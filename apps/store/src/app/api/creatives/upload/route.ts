import { createHash, randomUUID } from "node:crypto";
import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { corsHeadersFor, isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectUpload, type AcceptedUploadMime } from "@/lib/file-validation";

const allowedTypes = new Set<AcceptedUploadMime>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "application/pdf",
  "application/zip"
]);
const maximumBytes = 100 * 1024 * 1024;
const multipartOverheadBytes = 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const headersFor = (request: Request): Record<string, string> => {
  return { "cache-control": "private, no-store", ...corsHeadersFor(request) };
};

export async function POST(request: NextRequest) {
  const headers = headersFor(request);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes + multipartOverheadBytes) {
    return NextResponse.json(
      { message: "Arquivo acima do limite de 100 MB." },
      { status: 413, headers }
    );
  }
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ message: "Origem não autorizada." }, { status: 403, headers });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const creativeId = form?.get("creativeId");
  if (
    !(file instanceof File) ||
    typeof creativeId !== "string" ||
    !uuidPattern.test(creativeId)
  ) {
    return NextResponse.json({ message: "Arquivo inválido." }, { status: 400, headers });
  }
  if (
    !allowedTypes.has(file.type as AcceptedUploadMime) ||
    file.size < 1 ||
    file.size > maximumBytes
  ) {
    return NextResponse.json(
      { message: "Formato não permitido ou arquivo acima de 100 MB." },
      { status: 422, headers }
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspectUpload(bytes, file.type, allowedTypes);
  if (!inspected) {
    return NextResponse.json(
      { message: "O conteúdo do arquivo não corresponde a um formato seguro permitido." },
      { status: 422, headers }
    );
  }

  const demo =
    process.env.DEMO_MODE === "true"
      ? verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value)
      : null;
  if (demo) {
    if (!["admin", "manager"].includes(demo.role)) {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403, headers });
    }
    return NextResponse.json(
      { creativeId, name: file.name, size: file.size, demo: true },
      { status: 201, headers }
    );
  }

  const supabase = await createServerSupabaseClient();
  const userResult = supabase ? await supabase.auth.getUser() : null;
  if (!supabase || !userResult?.data.user) {
    return NextResponse.json({ message: "Entre para continuar." }, { status: 401, headers });
  }
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const path = `${creativeId}/${randomUUID()}.${inspected.extension}`;
  const upload = await supabase.storage
    .from("representative-creatives")
    .upload(path, bytes, { contentType: inspected.mime, upsert: false });
  if (upload.error) {
    return NextResponse.json({ message: "Falha ao armazenar o ativo." }, { status: 503, headers });
  }
  const update = await supabase
    .from("creative_assets")
    .update({
      storage_path: path,
      mime_type: inspected.mime,
      size_bytes: file.size,
      checksum_sha256: checksum
    })
    .eq("id", creativeId)
    .select("id,storage_path")
    .single();
  if (update.error) {
    await supabase.storage.from("representative-creatives").remove([path]);
    return NextResponse.json({ message: "Falha ao vincular o ativo." }, { status: 409, headers });
  }
  return NextResponse.json(update.data, { status: 201, headers });
}
