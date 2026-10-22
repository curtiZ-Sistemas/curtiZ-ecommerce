import { readJsonResponse } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { previewRepresentativeResale } from "@/lib/representative-resale";

const headers = { "cache-control": "private, no-store" };
const schema = z.object({ kitId: z.string().uuid(), icmsTaxpayer: z.boolean().optional() }).strict();
export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ message: "Origem não autorizada." }, { status: 403, headers });
  const body = await readJsonResponse(request, 1024);
  if (body instanceof Response) return body;
  const input = schema.safeParse(body);
  if (!input.success) return NextResponse.json({ message: "Dados inválidos." }, { status: 400, headers });
  const db = await createServerSupabaseClient();
  const auth = db ? await db.auth.getUser() : null;
  if (!db || auth?.error || !auth?.data.user) return NextResponse.json({ message: "Acesso negado." }, { status: 401, headers });
  const result = await db.rpc("read_representative_resale_context", { p_kit_id: input.data.kitId });
  if (result.error) return NextResponse.json({ message: "Conferência indisponível. Tente novamente." }, { status: 503, headers });
  if (!result.data) return NextResponse.json({ message: "Kit indisponível para seu perfil." }, { status: 404, headers });
  try {
    return NextResponse.json(previewRepresentativeResale(result.data, input.data.icmsTaxpayer), { headers });
  } catch {
    return NextResponse.json({ message: "Os dados deste kit precisam de revisão." }, { status: 409, headers });
  }
}
