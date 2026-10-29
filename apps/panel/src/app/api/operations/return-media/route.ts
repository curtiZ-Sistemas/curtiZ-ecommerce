import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const headers = { "cache-control": "private, no-store" };
export async function GET(request: Request) {
  const db = await createServerSupabaseClient();
  const auth = db ? await db.auth.getUser() : null;
  if (!db || !auth?.data.user || auth.error) return NextResponse.json({ message: "Acesso negado." }, { status: 401, headers });
  const permission = await db.rpc("has_permission", { permission_code: "returns.read" });
  if (permission.error || permission.data !== true) return NextResponse.json({ message: "Acesso negado." }, { status: 403, headers });
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/iu.test(id)) return NextResponse.json({ message: "Foto inválida." }, { status: 400, headers });
  const media = await db.from("return_media").select("storage_path").eq("id", id).maybeSingle();
  if (media.error || !media.data) return NextResponse.json({ message: "Foto indisponível." }, { status: media.error ? 503 : 404, headers });
  const path: unknown = media.data.storage_path;
  if (typeof path !== "string") return NextResponse.json({ message: "Foto indisponível." }, { status: 503, headers });
  const signed = await db.storage.from("return-evidence").createSignedUrl(path, 60);
  if (signed.error || !signed.data?.signedUrl) return NextResponse.json({ message: "Foto indisponível." }, { status: 503, headers });
  return NextResponse.redirect(signed.data.signedUrl, { status: 302, headers });
}
