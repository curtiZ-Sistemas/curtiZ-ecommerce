import { type NextRequest, NextResponse } from "next/server";
import { authorizeTechnicalRequest, safeTechnicalOrigin, technicalNoStore, unauthorizedTechnicalResponse } from "@/lib/technical-api";
import { melhorEnvioEnvironment } from "@/lib/melhor-envio-server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!safeTechnicalOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: technicalNoStore });
  const auth = await authorizeTechnicalRequest(request);
  if (!auth) return unauthorizedTechnicalResponse(request);
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.json({ message: "Integração indisponível." }, { status: 503, headers: technicalNoStore });
  const disconnected = await db.rpc("disconnect_integration_credential", {
    p_provider: "melhorenvio", p_environment: melhorEnvioEnvironment()
  });
  if (disconnected.error) return NextResponse.json({ message: "Não foi possível desconectar a integração." }, { status: 503, headers: technicalNoStore });
  await Promise.all([
    db.from("integration_health").upsert({ provider: "melhorenvio", state: "not_configured", checked_at: new Date().toISOString(),
      error_summary: null, metadata_sanitized: { environment: melhorEnvioEnvironment(), connected: false } }, { onConflict: "provider" }),
    db.from("audit_logs").insert({ actor_id: auth.userId, actor_role: "technical", action: "integration.melhorenvio.disconnected",
      entity_type: "integration", new_data_sanitized: { provider: "melhorenvio", environment: melhorEnvioEnvironment() } })
  ]);
  return NextResponse.json({ ok: true }, { headers: technicalNoStore });
}
