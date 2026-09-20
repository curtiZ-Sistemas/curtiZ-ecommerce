import { createHash, randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { authorizeTechnicalRequest, safeTechnicalOrigin, technicalNoStore, unauthorizedTechnicalResponse } from "@/lib/technical-api";
import { melhorEnvioEnvironment, panelMelhorEnvioProvider } from "@/lib/melhor-envio-server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

const scopes = ["cart-read", "cart-write", "orders-read", "shipping-calculate",
  "shipping-cancel", "shipping-checkout", "shipping-generate", "shipping-preview", "shipping-print", "shipping-tracking"];

export async function POST(request: NextRequest) {
  if (!safeTechnicalOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: technicalNoStore });
  const auth = await authorizeTechnicalRequest(request);
  if (!auth) return unauthorizedTechnicalResponse(request);
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.json({ message: "Integração indisponível." }, { status: 503, headers: technicalNoStore });
  try {
    const state = randomBytes(32).toString("base64url");
    const stateHash = createHash("sha256").update(state).digest("hex");
    const stored = await db.rpc("create_integration_oauth_state", {
      p_state_hash: stateHash, p_provider: "melhorenvio", p_actor_id: auth.userId,
      p_environment: melhorEnvioEnvironment(), p_return_path: "/tecnico",
      p_expires_at: new Date(Date.now() + 10 * 60_000).toISOString()
    });
    if (stored.error) throw new Error("state_not_stored");
    const authorizationUrl = panelMelhorEnvioProvider().authorizationUrl(state, scopes);
    await db.from("audit_logs").insert({ actor_id: auth.userId, actor_role: "technical",
      action: "integration.melhorenvio.connect_started", entity_type: "integration",
      new_data_sanitized: { provider: "melhorenvio", environment: melhorEnvioEnvironment() } });
    return NextResponse.json({ authorizationUrl }, { headers: technicalNoStore });
  } catch {
    return NextResponse.json({ message: "Não foi possível iniciar a conexão com o Melhor Envio." }, { status: 503, headers: technicalNoStore });
  }
}
