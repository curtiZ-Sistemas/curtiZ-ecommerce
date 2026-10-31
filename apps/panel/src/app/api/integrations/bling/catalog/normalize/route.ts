import { BlingError, normalizeBlingCatalogSku } from "@curtiz/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { authorizeBlingTechnicalRequest, panelBlingClient } from "@/lib/bling-server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { safeTechnicalOrigin, technicalNoStore, unauthorizedTechnicalResponse } from "@/lib/technical-api";

export async function POST(request: NextRequest) {
  if (!safeTechnicalOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: technicalNoStore });
  const auth = await authorizeBlingTechnicalRequest(request);
  if (!auth) return unauthorizedTechnicalResponse(request);
  const input: unknown = await request.json().catch(() => null);
  const variantId = input !== null && typeof input === "object" && "variantId" in input ? input.variantId : null;
  if (typeof variantId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(variantId))
    return NextResponse.json({ message: "Variante inválida." }, { status: 400, headers: technicalNoStore });
  const db = createServiceSupabaseClient();
  if (!db || process.env.BLING_PRODUCT_SYNC_ENABLED !== "true")
    return NextResponse.json({ message: "Sincronização indisponível." }, { status: 409, headers: technicalNoStore });
  try {
    const result = await normalizeBlingCatalogSku({ rpc: async (name, args) => db.rpc(name, args), provider: panelBlingClient(db), environment: process.env, variantId });
    await db.from("audit_logs").insert({ actor_id: auth.userId, actor_role: "technical", action: "integration.bling.provider_sku_normalized",
      entity_type: "product_variant", entity_id: variantId, new_data_sanitized: result });
    return NextResponse.json(result, { headers: technicalNoStore });
  } catch (error) {
    return NextResponse.json({ message: "Código externo não alterado ou sem confirmação. Confira o vínculo antes de repetir.",
      code: error instanceof BlingError ? error.code : "normalization_failed" }, { status: 409, headers: technicalNoStore });
  }
}
