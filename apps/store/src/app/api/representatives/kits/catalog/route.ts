import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const headers = { "cache-control": "private, no-store" };
export async function GET(request: NextRequest) {
  const offset = z.coerce.number().int().min(0).max(10000).safeParse(request.nextUrl.searchParams.get("offset") ?? 0);
  if (!offset.success) return NextResponse.json({ message: "Página inválida." }, { status: 400, headers });
  const db = await createServerSupabaseClient();
  const auth = db ? await db.auth.getUser() : null;
  if (!db || auth?.error || !auth?.data.user) return NextResponse.json({ message: "Acesso negado." }, { status: 401, headers });
  const result = await db.rpc("list_representative_catalog_kits", { p_offset: offset.data });
  if (result.error) return NextResponse.json({ message: "Não foi possível carregar os kits. Tente novamente." }, { status: 503, headers });
  if (!result.data) return NextResponse.json({ message: "Acesso de representante indisponível." }, { status: 403, headers });
  return NextResponse.json(result.data, { headers });
}
