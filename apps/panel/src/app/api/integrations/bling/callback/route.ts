import { createHash } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { authorizeBlingTechnicalRequest, blingCallbackUrl, blingEnvironment, panelBlingClient } from "@/lib/bling-server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

const destination = (result: "connected" | "error") => new URL(`/tecnico/integracoes?bling=${result}`,
  process.env.NEXT_PUBLIC_PANEL_URL || process.env.BLING_REDIRECT_URI);

export async function GET(request: NextRequest) {
  let validOrigin = false;
  try { validOrigin = new URL(request.url).origin === blingCallbackUrl().origin; } catch { /* invalid setup */ }
  if (!validOrigin) return new NextResponse(null, { status: 403 });
  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  const state = request.nextUrl.searchParams.get("state")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{32,256}$/u.test(state) || !/^[A-Za-z0-9_-]{1,512}$/u.test(code))
    return NextResponse.redirect(destination("error"));
  const auth = await authorizeBlingTechnicalRequest(request, { mutation: false });
  if (!auth) return NextResponse.redirect(destination("error"));
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.redirect(destination("error"));
  const consumed = await db.rpc("consume_integration_oauth_state", {
    p_state_hash: createHash("sha256").update(state).digest("hex"), p_provider: "bling",
    p_actor_id: auth.userId, p_environment: blingEnvironment()
  });
  if (consumed.error || consumed.data !== "/tecnico/integracoes") return NextResponse.redirect(destination("error"));
  try {
    const client = panelBlingClient(db);
    await client.exchangeCode(code);
    const company = await client.request("/empresas/me/dados-basicos") as { data?: { id?: unknown; nome?: unknown } };
    if (typeof company.data?.id !== "string" || typeof company.data.nome !== "string") throw new Error("company_unverified");
    const account = await db.rpc("save_bling_account", { p_environment: blingEnvironment(),
      p_company_id: company.data.id, p_company_name: company.data.nome });
    if (account.error) throw new Error("company_not_stored");
    await client.completeConnection();
    await db.rpc("record_bling_api_health", { p_environment: blingEnvironment(), p_healthy: true });
    await db.from("audit_logs").insert({ actor_id: auth.userId, actor_role: "technical",
      action: "integration.bling.connected", entity_type: "integration",
      new_data_sanitized: { provider: "bling", environment: blingEnvironment() } });
    return NextResponse.redirect(destination("connected"));
  } catch {
    return NextResponse.redirect(destination("error"));
  }
}
