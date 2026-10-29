import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { returnPhotoMaximumBytes, validateReturnPhotos } from "@curtiz/domain";
import { inspectUpload, type AcceptedUploadMime } from "@/lib/file-validation";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { prepareUploadImage } from "@/lib/image-upload";
import { PrivateRequestError, readPrivateFormData, requirePrivateRateLimit } from "@/lib/private-request";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readString } from "@/lib/unknown-data";

const types = new Set<AcceptedUploadMime>(["image/jpeg", "image/png", "image/webp"]);
const reply = (message: string, status: number) => NextResponse.json({ message }, { status, headers: { "cache-control": "private, no-store" } });

export async function GET(request: Request) {
  const db = await createServerSupabaseClient();
  const auth = db ? await db.auth.getUser() : null;
  if (!db || !auth?.data.user || auth.error) return reply("Entre para continuar.", 401);
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/iu.test(id)) return reply("Foto inválida.", 400);
  const media = await db.from("return_media").select("storage_path").eq("id", id).maybeSingle();
  if (media.error) return reply("Foto indisponível.", 503);
  if (!media.data) return reply("Foto não encontrada.", 404);
  const path: unknown = media.data.storage_path;
  if (typeof path !== "string") return reply("Foto indisponível.", 503);
  const signed = await db.storage.from("return-evidence").createSignedUrl(path, 60);
  if (signed.error || !signed.data?.signedUrl) return reply("Foto indisponível.", 503);
  return NextResponse.redirect(signed.data.signedUrl, { status: 302, headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request)) return reply("Origem não autorizada.", 403);
  const db = await createServerSupabaseClient();
  const auth = db ? await db.auth.getUser() : null;
  const user = auth?.data.user;
  if (!db || !user || auth?.error) return reply("Entre para continuar.", 401);
  try {
    await requirePrivateRateLimit(db, "customer_upload");
    const form = await readPrivateFormData(request, returnPhotoMaximumBytes + 512 * 1024);
    const file = form.get("file");
    const returnId = form.get("returnId");
    if (!(file instanceof File) || typeof returnId !== "string" || !/^[0-9a-f-]{36}$/iu.test(returnId)) return reply("Arquivo inválido.", 400);
    const invalid = validateReturnPhotos([file]);
    if (invalid) return reply(invalid, 422);
    const result = await db.from("returns").select("id,status,return_media(id)").eq("id", returnId).eq("customer_id", user.id).maybeSingle();
    if (result.error) return reply("Não foi possível consultar a solicitação.", 503);
    if (!isUnknownRecord(result.data) || !["requested", "in_review", "waiting_photos"].includes(readString(result.data, "status")))
      return reply("Esta solicitação não aceita novas fotos.", 409);
    if (Array.isArray(result.data.return_media) && result.data.return_media.length >= 3) return reply("Esta solicitação já possui 3 fotos.", 409);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!inspectUpload(bytes, file.type, types)) return reply("O conteúdo da foto é inválido.", 422);
    const prepared = await prepareUploadImage(bytes, returnPhotoMaximumBytes);
    const service = createServiceSupabaseClient();
    if (!service) return reply("Upload indisponível no momento.", 503);
    const path = `${user.id}/${returnId}/${randomUUID()}.webp`;
    const uploaded = await service.storage.from("return-evidence").upload(path, prepared, { contentType: "image/webp", upsert: false });
    if (uploaded.error) return reply("Não foi possível armazenar a foto.", 503);
    const attached = await db.rpc("attach_customer_return_photo", { p_return_id: returnId, p_path: path });
    if (attached.error) {
      await service.storage.from("return-evidence").remove([path]);
      return reply("A foto não foi vinculada. Confira o limite de 3 fotos e a etapa da solicitação.", 409);
    }
    const attachedId: unknown = attached.data;
    return NextResponse.json({ ok: true, id: typeof attachedId === "string" ? attachedId : null }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return reply("Não foi possível enviar a foto. Use JPG, PNG ou WebP com até 5 MB.", error instanceof PrivateRequestError ? error.status : 503);
  }
}
