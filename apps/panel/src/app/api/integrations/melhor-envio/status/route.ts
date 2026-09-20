import { type NextRequest, NextResponse } from "next/server";
import { authorizeTechnicalRequest, technicalNoStore, unauthorizedTechnicalResponse } from "@/lib/technical-api";
import { melhorEnvioEnvironment, melhorEnvioOriginMissingFields, panelMelhorEnvioProvider } from "@/lib/melhor-envio-server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const auth = await authorizeTechnicalRequest(request, { mutation: false });
  if (!auth) return unauthorizedTechnicalResponse(request);
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.json({ message: "Integração indisponível." }, { status: 503, headers: technicalNoStore });
  const credential = await db.rpc("read_integration_credential", { p_provider: "melhorenvio", p_environment: melhorEnvioEnvironment() });
  if (credential.error) return NextResponse.json({ message: "Status da integração indisponível." }, { status: 503, headers: technicalNoStore });
  const row = credential.data && typeof credential.data === "object" && !Array.isArray(credential.data)
    ? credential.data as Record<string, unknown> : null;
  const connected = row?.status === "connected";
  const originMissingFields = melhorEnvioOriginMissingFields();
  const started = Date.now();
  let health = "not_configured";
  if (connected) {
    try { health = await panelMelhorEnvioProvider().health(); }
    catch { health = "offline"; }
  }
  const latencyMs = Date.now() - started;
  const checkedAt = new Date().toISOString();
  const lastError = health === "online" || health === "not_configured" ? null : "connection_check_failed";
  await db.from("integration_health").upsert({ provider: "melhorenvio", state: health, checked_at: checkedAt,
    latency_ms: latencyMs, error_summary: lastError,
    metadata_sanitized: { environment: melhorEnvioEnvironment(), connected,
      webhookConfigured: process.env.MELHOR_ENVIO_WEBHOOK_CONFIGURED === "true",
      originComplete: originMissingFields.length === 0 } }, { onConflict: "provider" });
  return NextResponse.json({ environment: melhorEnvioEnvironment(), connected, health, latencyMs,
    accessTokenExpiresAt: connected && typeof row?.access_token_expires_at === "string" ? row.access_token_expires_at : null,
    webhookConfigured: process.env.MELHOR_ENVIO_WEBHOOK_CONFIGURED === "true",
    originComplete: originMissingFields.length === 0, originMissingFields, lastCheckedAt: checkedAt, lastError }, { headers: technicalNoStore });
}
