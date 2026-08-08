import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeManagerRequest,
  managerNoStore,
  safeManagerOrigin,
  unauthorizedManagerResponse
} from "@/lib/manager-api";

export const dynamic = "force-dynamic";

const restoreSchema = z.object({
  versionId: z.string().uuid(),
  reason: z.string().trim().min(3).max(1000)
});

export async function GET(request: NextRequest) {
  const auth = await authorizeManagerRequest(request);
  if (!auth) return unauthorizedManagerResponse();

  const result = await auth.supabase
    .from("homepage_section_versions")
    .select("id,section_id,version,created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (result.error) {
    return NextResponse.json(
      { message: "Não foi possível carregar o histórico da página inicial." },
      { status: 503, headers: managerNoStore }
    );
  }

  return NextResponse.json({ items: result.data ?? [] }, { headers: managerNoStore });
}

export async function POST(request: NextRequest) {
  if (!safeManagerOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: managerNoStore }
    );
  }

  const auth = await authorizeManagerRequest(request);
  if (!auth) return unauthorizedManagerResponse();

  const parsed = restoreSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Informe a versão e uma justificativa válida." },
      { status: 400, headers: managerNoStore }
    );
  }

  const result = await auth.supabase.rpc("manager_restore_homepage_section", {
    p_version_id: parsed.data.versionId,
    p_reason: parsed.data.reason
  });
  if (result.error) {
    return NextResponse.json(
      { message: "Não foi possível restaurar esta versão." },
      { status: 409, headers: managerNoStore }
    );
  }

  return NextResponse.json(
    { message: "Versão restaurada e registrada na auditoria." },
    { headers: managerNoStore }
  );
}
