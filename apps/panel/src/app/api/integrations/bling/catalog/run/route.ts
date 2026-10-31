import { BlingError, runBlingCatalogBatch } from "@curtiz/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { authorizeBlingTechnicalRequest } from "@/lib/bling-server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { safeTechnicalOrigin, technicalNoStore, unauthorizedTechnicalResponse } from "@/lib/technical-api";

export async function POST(request: NextRequest) {
  if (!safeTechnicalOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: technicalNoStore });
  const auth = await authorizeBlingTechnicalRequest(request);
  if (!auth) return unauthorizedTechnicalResponse(request);
  const input: unknown = await request.json().catch(() => null);
  const limit = input && typeof input === "object" && "limit" in input ? input.limit : 4;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 8)
    return NextResponse.json({ message: "Lote inválido." }, { status: 400, headers: technicalNoStore });
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.json({ message: "Integração indisponível." }, { status: 503, headers: technicalNoStore });
  try {
    const result = await runBlingCatalogBatch(process.env, async (name, args) => db.rpc(name, args), limit);
    const audit = await db.from("audit_logs").insert({ actor_id: auth.userId, actor_role: "technical",
      action: "integration.bling.catalog_batch", entity_type: "integration", new_data_sanitized: result });
    if (audit.error) throw new BlingError("audit_unavailable", 503, true);
    return NextResponse.json(result, { headers: technicalNoStore });
  } catch (error) {
    return NextResponse.json({ message: "Não foi possível concluir o lote.", code: error instanceof BlingError ? error.code : "catalog_batch_failed" },
      { status: 503, headers: technicalNoStore });
  }
}
