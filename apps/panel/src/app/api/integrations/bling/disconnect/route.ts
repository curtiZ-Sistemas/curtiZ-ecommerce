import { type NextRequest, NextResponse } from "next/server";
import { safeTechnicalOrigin, technicalNoStore, unauthorizedTechnicalResponse } from "@/lib/technical-api";
import { authorizeBlingTechnicalRequest, blingEnvironment, panelBlingClient } from "@/lib/bling-server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!safeTechnicalOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: technicalNoStore });
  const auth = await authorizeBlingTechnicalRequest(request);
  if (!auth) return unauthorizedTechnicalResponse(request);
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.json({ message: "Integração indisponível." }, { status: 503, headers: technicalNoStore });
  try {
    await panelBlingClient(db).revoke();
    await db.from("audit_logs").insert({ actor_id: auth.userId, actor_role: "technical",
      action: "integration.bling.disconnected", entity_type: "integration",
      new_data_sanitized: { provider: "bling", environment: blingEnvironment() } });
    return NextResponse.json({ ok: true }, { headers: technicalNoStore });
  } catch {
    return NextResponse.json({ message: "Revogação não confirmada; conexão preservada para nova tentativa." },
      { status: 503, headers: technicalNoStore });
  }
}
