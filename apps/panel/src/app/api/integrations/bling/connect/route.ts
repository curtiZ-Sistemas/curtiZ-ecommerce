import { createHash, randomBytes } from "node:crypto";
import { blingAuthorizationUrl } from "@curtiz/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { safeTechnicalOrigin, technicalNoStore, unauthorizedTechnicalResponse } from "@/lib/technical-api";
import { authorizeBlingTechnicalRequest, blingCallbackUrl, blingEnvironment, blingConfigured } from "@/lib/bling-server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!safeTechnicalOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: technicalNoStore });
  const auth = await authorizeBlingTechnicalRequest(request);
  if (!auth) return unauthorizedTechnicalResponse(request);
  if (!blingConfigured()) return NextResponse.json({ message: "Configure o aplicativo Bling neste ambiente." }, { status: 503, headers: technicalNoStore });
  try {
    const callback = blingCallbackUrl();
    if (new URL(request.url).origin !== callback.origin) throw new Error("callback_origin_mismatch");
    const db = createServiceSupabaseClient();
    if (!db) throw new Error("database_unavailable");
    const state = randomBytes(32).toString("base64url");
    const stored = await db.rpc("create_integration_oauth_state", {
      p_state_hash: createHash("sha256").update(state).digest("hex"), p_provider: "bling",
      p_actor_id: auth.userId, p_environment: blingEnvironment(), p_return_path: "/tecnico/integracoes",
      p_expires_at: new Date(Date.now() + 5 * 60_000).toISOString()
    });
    if (stored.error) throw new Error("state_not_stored");
    await db.from("audit_logs").insert({ actor_id: auth.userId, actor_role: "technical",
      action: "integration.bling.connect_started", entity_type: "integration",
      new_data_sanitized: { provider: "bling", environment: blingEnvironment() } });
    return NextResponse.json({ authorizationUrl: blingAuthorizationUrl(process.env.BLING_CLIENT_ID!, state) },
      { headers: technicalNoStore });
  } catch {
    return NextResponse.json({ message: "Não foi possível iniciar a conexão com o Bling." }, { status: 503, headers: technicalNoStore });
  }
}
