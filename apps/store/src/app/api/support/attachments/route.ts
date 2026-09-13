import { randomUUID } from "node:crypto";
import { sanitizePlainText } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addDemoSupportMessage } from "@/lib/demo-support-store";
import { corsHeadersFor, isAllowedRequestOrigin } from "@/lib/http-origin";
import { getSupportActor } from "@/lib/support-actor";
import { PrivateRequestError, readBoundedBody } from "@/lib/private-request";
import { readQueryResult } from "@/lib/unknown-data";

const inputSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
  internal: z.enum(["true", "false"]).default("false")
});

const allowedTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"]
]);

function hasExpectedSignature(bytes: Uint8Array, type: string) {
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
  if (type === "image/webp")
    return (
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    );
  if (type === "application/pdf") return new TextDecoder().decode(bytes.slice(0, 4)) === "%PDF";
  return false;
}

const response = (request: Request, body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store", ...corsHeadersFor(request) }
  });

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeadersFor(request) });
}

async function upload(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return response(request, { ok: false }, 403);
  const actor = await getSupportActor(request, "support_upload");
  if (!actor) return response(request, { ok: false, message: "Entre para anexar arquivos." }, 401);
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw new PrivateRequestError(415);
  const body = await readBoundedBody(request, 10 * 1024 * 1024 + 64 * 1024);
  const form = await new Response(body as BodyInit, { headers: { "content-type": contentType } }).formData().catch(() => {
    throw new PrivateRequestError(400);
  });
  const parsed = inputSchema.safeParse({
    conversationId: form.get("conversationId"),
    message: form.get("message"),
    internal: form.get("internal") ?? "false"
  });
  const file = form.get("file");
  if (!parsed.success || !(file instanceof File)) {
    return response(request, { ok: false, message: "Revise a mensagem e o arquivo." }, 400);
  }
  const extension = allowedTypes.get(file.type);
  if (!extension || file.size < 1 || file.size > 10 * 1024 * 1024) {
    return response(
      request,
      { ok: false, message: "Use JPG, PNG, WebP ou PDF de até 10 MB." },
      400
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasExpectedSignature(bytes, file.type)) {
    return response(
      request,
      { ok: false, message: "O conteúdo do arquivo não corresponde ao formato informado." },
      400
    );
  }
  const message = sanitizePlainText(parsed.data.message);
  if (!message) throw new PrivateRequestError(400);
  const safeName =
    file.name.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 160) || `anexo.${extension}`;
  if (actor.kind === "demo") {
    addDemoSupportMessage(
      {
        email: actor.email,
        fullName: actor.fullName,
        role: actor.role
      },
      parsed.data.conversationId,
      `${message}\n[Anexo validado: ${safeName}]`,
      parsed.data.internal === "true"
    );
    return response(request, { ok: true, demo: true }, 201);
  }

  const supabase = actor.supabase;
  if (!supabase || !actor.userId) throw new PrivateRequestError(401);
  const conversation = await supabase
    .from("support_conversations")
    .select("id")
    .eq("id", parsed.data.conversationId)
    .maybeSingle();
  if (conversation.error || !conversation.data)
    return response(request, { ok: false, message: "Chamado não encontrado." }, 404);
  const senderRole = actor.role;
  if (parsed.data.internal === "true" && senderRole === "customer")
    return response(request, { ok: false }, 403);
  const storagePath = `${actor.userId}/support/${parsed.data.conversationId}/${randomUUID()}.${extension}`;
  const upload = await supabase.storage
    .from("customer-private")
    .upload(storagePath, bytes, { contentType: file.type, upsert: false });
  if (upload.error)
    return response(request, { ok: false, message: "Não foi possível armazenar o arquivo." }, 503);
  const messageInsert = await supabase
    .from("support_messages")
    .insert({
      conversation_id: parsed.data.conversationId,
      sender_id: actor.userId,
      sender_role: senderRole,
      content_sanitized: message,
      is_internal_note: parsed.data.internal === "true"
    })
    .select("id")
    .single();
  if (messageInsert.error || !messageInsert.data) {
    await supabase.storage.from("customer-private").remove([storagePath]);
    return response(request, { ok: false, message: "A mensagem não foi autorizada." }, 403);
  }
  const attachmentResponse: unknown = await supabase.from("support_attachments").insert({
    message_id: messageInsert.data.id,
    storage_path: storagePath,
    original_name_sanitized: safeName,
    mime_type: file.type,
    size_bytes: file.size,
    scan_status: "pending"
  });
  const attachment = readQueryResult(attachmentResponse);
  if (attachment.error) {
    await supabase.storage.from("customer-private").remove([storagePath]);
    return response(
      request,
      {
        ok: false,
        partial: true,
        message: "A mensagem foi enviada, mas o anexo não foi associado."
      },
      409
    );
  }
  return response(request, { ok: true }, 201);
}

const failure = (request: Request, error: unknown) => response(request, {
  ok: false, message: "Não foi possível acessar o anexo. Tente novamente."
}, error instanceof PrivateRequestError ? error.status : 503);

export async function POST(request: NextRequest) {
  try { return await upload(request); } catch (error) { return failure(request, error); }
}

export async function GET(request: NextRequest) {
  try {
    if (!isAllowedRequestOrigin(request)) throw new PrivateRequestError(403);
    const actor = await getSupportActor(request, "support_download");
    if (!actor) throw new PrivateRequestError(401);
    const id = z.string().uuid().safeParse(request.nextUrl.searchParams.get("id"));
    if (!id.success) throw new PrivateRequestError(400);
    if (!actor.supabase) throw new PrivateRequestError(404);
    // Both metadata and object are read through the user's RLS policies on every download.
    const attachment = await actor.supabase.from("support_attachments")
      .select("storage_path,original_name_sanitized,mime_type,scan_status")
      .eq("id", id.data).eq("scan_status", "clean").maybeSingle();
    if (attachment.error) throw new PrivateRequestError(503);
    const metadata = z.object({ storage_path: z.string().min(1).max(2048), original_name_sanitized: z.string(),
      mime_type: z.string(), scan_status: z.literal("clean") }).safeParse(attachment.data);
    if (!metadata.success || !allowedTypes.has(metadata.data.mime_type)) throw new PrivateRequestError(404);
    const file = await actor.supabase.storage.from("customer-private").download(metadata.data.storage_path);
    if (file.error || !file.data) throw new PrivateRequestError(404);
    const name = metadata.data.original_name_sanitized.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0,160) || "anexo";
    return new NextResponse(file.data, { headers: {
      ...corsHeadersFor(request), "cache-control": "private, no-store",
      "content-type": metadata.data.mime_type, "x-content-type-options": "nosniff",
      "content-disposition": 'attachment; filename="' + name + '"',
      "content-security-policy": "default-src 'none'; sandbox"
    } });
  } catch (error) { return failure(request, error); }
}
