import { randomUUID } from "node:crypto";
import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { inspectUpload, type AcceptedUploadMime } from "@/lib/file-validation";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readQueryResult, readString } from "@/lib/unknown-data";

const allowedTypes = new Set<AcceptedUploadMime>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4"
]);
const maximumBytes = 15 * 1024 * 1024;
const multipartOverheadBytes = 512 * 1024;
const noStore = { "cache-control": "private, no-store" };

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes + multipartOverheadBytes) {
    return NextResponse.json(
      { message: "Arquivo acima do limite de 15 MB." },
      { status: 413, headers: noStore }
    );
  }
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não autorizada." },
      { status: 403, headers: noStore }
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const reviewId = form?.get("reviewId");
  if (!(file instanceof File) || typeof reviewId !== "string") {
    return NextResponse.json(
      { message: "Arquivo inválido." },
      { status: 400, headers: noStore }
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspectUpload(bytes, file.type, allowedTypes);
  if (
    !inspected ||
    !allowedTypes.has(file.type as AcceptedUploadMime) ||
    file.size < 1 ||
    file.size > maximumBytes
  ) {
    return NextResponse.json(
      { message: "Envie JPG, PNG, WebP ou MP4 com até 15 MB." },
      { status: 422, headers: noStore }
    );
  }

  const demoSession =
    process.env.DEMO_MODE === "true"
      ? verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value)
      : null;
  if (demoSession) {
    if (!demoSession.roles.includes("customer")) {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403, headers: noStore });
    }
    return NextResponse.json({ id: randomUUID(), demo: true }, { status: 201, headers: noStore });
  }

  const supabase = await createServerSupabaseClient();
  const userResult = supabase ? await supabase.auth.getUser() : null;
  const user = userResult?.data.user;
  if (!supabase || !user) {
    return NextResponse.json(
      { message: "Entre para continuar." },
      { status: 401, headers: noStore }
    );
  }

  const reviewResponse = await supabase
    .from("reviews")
    .select("id,status")
    .eq("id", reviewId)
    .eq("customer_id", user.id)
    .maybeSingle();
  const review = readQueryResult(reviewResponse).data;
  if (
    !isUnknownRecord(review) ||
    !["pending", "rejected"].includes(readString(review, "status"))
  ) {
    return NextResponse.json(
      { message: "Esta avaliação não aceita novos arquivos." },
      { status: 409, headers: noStore }
    );
  }

  const path = `${user.id}/reviews/${reviewId}/${randomUUID()}.${inspected.extension}`;
  const upload = await supabase.storage
    .from("customer-private")
    .upload(path, bytes, { contentType: inspected.mime, upsert: false });
  if (upload.error) {
    return NextResponse.json(
      { message: "Não foi possível armazenar o arquivo." },
      { status: 503, headers: noStore }
    );
  }
  const inserted = await supabase
    .from("review_media")
    .insert({
      review_id: reviewId,
      customer_id: user.id,
      storage_path: path,
      media_type: inspected.mime === "video/mp4" ? "video" : "image",
      mime_type: inspected.mime,
      size_bytes: file.size
    })
    .select("id")
    .single();
  if (inserted.error) {
    await supabase.storage.from("customer-private").remove([path]);
    return NextResponse.json(
      { message: "Não foi possível vincular o arquivo à avaliação." },
      { status: 409, headers: noStore }
    );
  }
  return NextResponse.json(inserted.data, { status: 201, headers: noStore });
}
