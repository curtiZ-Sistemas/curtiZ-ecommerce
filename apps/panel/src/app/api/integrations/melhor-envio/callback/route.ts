import { createHash } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { hasRequiredInternalMfa } from "@/lib/internal-mfa";
import { melhorEnvioEnvironment, panelMelhorEnvioProvider } from "@/lib/melhor-envio-server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

const destination = (request: NextRequest, result: "connected" | "error") => {
  const configuredPanel = process.env.NEXT_PUBLIC_PANEL_URL?.trim();
  try { return new URL(`/tecnico?melhorEnvio=${result}`, configuredPanel || request.url); }
  catch { return new URL(`/tecnico?melhorEnvio=${result}`, request.url); }
};

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  const state = request.nextUrl.searchParams.get("state")?.trim() ?? "";
  if (!code || !/^[A-Za-z0-9_-]{32,256}$/u.test(state)) return NextResponse.redirect(destination(request, "error"));
  const auth = await createServerSupabaseClient();
  const userResult = auth ? await auth.auth.getUser() : null;
  const user = userResult?.data.user;
  if (!auth || !user || userResult?.error || !(await hasRequiredInternalMfa(auth))) {
    return NextResponse.redirect(destination(request, "error"));
  }
  const roleResult = await auth.from("user_roles").select("role").eq("user_id", user.id).eq("role", "technical").maybeSingle();
  if (roleResult.error || !roleResult.data) return NextResponse.redirect(destination(request, "error"));
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.redirect(destination(request, "error"));
  const consumed = await db.rpc("consume_integration_oauth_state", {
    p_state_hash: createHash("sha256").update(state).digest("hex"), p_provider: "melhorenvio",
    p_actor_id: user.id, p_environment: melhorEnvioEnvironment()
  });
  if (consumed.error || typeof consumed.data !== "string") return NextResponse.redirect(destination(request, "error"));
  try {
    await panelMelhorEnvioProvider().exchangeAuthorizationCode(code);
    await Promise.all([
      db.from("integration_health").upsert({ provider: "melhorenvio", state: "online", checked_at: new Date().toISOString(),
        error_summary: null, metadata_sanitized: { environment: melhorEnvioEnvironment(), connected: true } }, { onConflict: "provider" }),
      db.from("audit_logs").insert({ actor_id: user.id, actor_role: "technical", action: "integration.melhorenvio.connected",
        entity_type: "integration", new_data_sanitized: { provider: "melhorenvio", environment: melhorEnvioEnvironment() } })
    ]);
    return NextResponse.redirect(destination(request, "connected"));
  } catch {
    await db.from("integration_health").upsert({ provider: "melhorenvio", state: "degraded", checked_at: new Date().toISOString(),
      error_summary: "oauth_exchange_failed", metadata_sanitized: { environment: melhorEnvioEnvironment(), connected: false } }, { onConflict: "provider" });
    return NextResponse.redirect(destination(request, "error"));
  }
}
