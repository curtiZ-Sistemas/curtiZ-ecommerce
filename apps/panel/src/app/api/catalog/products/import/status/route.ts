import { postgresUuidSchema } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest, privateNoStore, unauthorizedAdminResponse } from "@/lib/admin-api";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse(request);
  const parsed = postgresUuidSchema.safeParse(request.nextUrl.searchParams.get("runId"));
  if (!parsed.success) return NextResponse.json({ message: "Execução de importação inválida." }, { status: 400, headers: privateNoStore });
  const status = await auth.supabase.rpc("get_product_import_status", { p_run_id: parsed.data });
  if (status.error) {
    const missing = status.error.code === "P0002";
    return NextResponse.json({
      message: missing ? "Execução de importação não encontrada." : "Não foi possível consultar o progresso da importação.",
      code: missing ? "IMPORT_RUN_NOT_FOUND" : "IMPORT_STATUS_UNAVAILABLE"
    }, { status: missing ? 404 : 503, headers: privateNoStore });
  }
  return NextResponse.json(status.data, { headers: privateNoStore });
}
