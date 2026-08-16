import { randomUUID } from "node:crypto";
import { DEMO_SESSION_COOKIE, sanitizePlainText, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addDemoSupportMessage } from "@/lib/demo-support-store";
import { corsHeadersFor, isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readQueryResult, readRows, readString } from "@/lib/unknown-data";

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

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return response(request, { ok: false }, 403);
  const form = await request.formData();
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
  const safeName =
    file.name.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 160) || `anexo.${extension}`;
  const demo = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demo) {
    addDemoSupportMessage(
      {
        email: demo.email,
        fullName: demo.fullName,
        role: demo.role === "representative" ? "customer" : demo.role
      },
      parsed.data.conversationId,
      `${message}\n[Anexo validado: ${safeName}]`,
      parsed.data.internal === "true"
    );
    return response(request, { ok: true, demo: true }, 201);
  }

  const supabase = await createServerSupabaseClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!supabase || !user)
    return response(request, { ok: false, message: "Entre para anexar arquivos." }, 401);
  const conversation = await supabase
    .from("support_conversations")
    .select("id")
    .eq("id", parsed.data.conversationId)
    .maybeSingle();
  if (conversation.error || !conversation.data)
    return response(request, { ok: false, message: "Chamado não encontrado." }, 404);
  const roles = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const internalRole = readRows(roles.data)
    .map((row) => readString(row, "role"))
    .find((role) => ["operational", "admin", "manager", "technical"].includes(role));
  const senderRole = internalRole ?? "customer";
  if (parsed.data.internal === "true" && senderRole === "customer")
    return response(request, { ok: false }, 403);
  const storagePath = `${user.id}/support/${parsed.data.conversationId}/${randomUUID()}.${extension}`;
  const upload = await supabase.storage
    .from("customer-private")
    .upload(storagePath, bytes, { contentType: file.type, upsert: false });
  if (upload.error)
    return response(request, { ok: false, message: "Não foi possível armazenar o arquivo." }, 503);
  const messageInsert = await supabase
    .from("support_messages")
    .insert({
      conversation_id: parsed.data.conversationId,
      sender_id: user.id,
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
