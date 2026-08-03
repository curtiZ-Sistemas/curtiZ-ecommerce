import { randomUUID } from "node:crypto";
import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { inspectUpload, type AcceptedUploadMime } from "@/lib/file-validation";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readQueryResult, readString } from "@/lib/unknown-data";

const allowedTypes = new Set<AcceptedUploadMime>([
  "image/jpeg",
  "image/png",
  "image/webp"
]);
const maximumBytes = 5 * 1024 * 1024;
const noStore = { "cache-control": "private, no-store" };

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não autorizada." },
      { status: 403, headers: noStore }
    );
  }
  if (Number(request.headers.get("content-length") ?? 0) > maximumBytes + 256 * 1024) {
    return NextResponse.json(
      { message: "Imagem acima do limite de 5 MB." },
      { status: 413, headers: noStore }
    );
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { message: "Selecione uma imagem válida." },
      { status: 400, headers: noStore }
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspectUpload(bytes, file.type, allowedTypes);
  if (!inspected || file.size < 1 || file.size > maximumBytes) {
    return NextResponse.json(
      { message: "Envie JPG, PNG ou WebP com até 5 MB." },
      { status: 422, headers: noStore }
    );
  }

  const demo =
    process.env.DEMO_MODE === "true"
      ? verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value)
      : null;
  if (demo) {
    if (!demo.roles.includes("customer")) {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403, headers: noStore });
    }
    return NextResponse.json(
      { ok: true, simulated: true, message: "Avatar validado no modo de demonstração." },
      { headers: noStore }
    );
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
  const currentResponse = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", user.id)
    .maybeSingle();
  const current = readQueryResult(currentResponse).data;
  const oldPath = isUnknownRecord(current) ? readString(current, "avatar_path") : "";
  const path = `${user.id}/avatar/${randomUUID()}.${inspected.extension}`;
  const upload = await supabase.storage
    .from("customer-private")
    .upload(path, bytes, { contentType: inspected.mime, upsert: false });
  if (upload.error) {
    return NextResponse.json(
      { message: "Não foi possível armazenar a imagem." },
      { status: 503, headers: noStore }
    );
  }
  const updated = await supabase
    .from("profiles")
    .update({ avatar_path: path, updated_at: new Date().toISOString() })
    .eq("id", user.id);
  if (updated.error) {
    await supabase.storage.from("customer-private").remove([path]);
    return NextResponse.json(
      { message: "Não foi possível atualizar o avatar." },
      { status: 409, headers: noStore }
    );
  }
  if (oldPath && oldPath !== path) {
    await supabase.storage.from("customer-private").remove([oldPath]);
  }
  revalidatePath("/minha-conta", "layout");
  return NextResponse.json({ ok: true }, { headers: noStore });
}
