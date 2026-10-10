import { type NextRequest, NextResponse } from "next/server";
import { getMelhorEnvioReadiness } from "@curtiz/config";
import { inspectMelhorEnvioCredentialKeys, type MelhorEnvioCredentialKeyReport, type MelhorEnvioFailureDetails } from "@curtiz/integrations";
import { authorizeTechnicalRequest, technicalNoStore, unauthorizedTechnicalResponse } from "@/lib/technical-api";
import {
  melhorEnvioEnvironment,
  melhorEnvioOriginMissingFields,
  panelMelhorEnvioProvider,
  panelMelhorEnvioTokenKeyring
} from "@/lib/melhor-envio-server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { getStoreShippingService, melhorEnvioFailureLabel } from "@/lib/store-shipping-health";

const text = (value: unknown) => typeof value === "string" ? value : "";

export async function GET(request: NextRequest) {
  const auth = await authorizeTechnicalRequest(request, { mutation: false });
  if (!auth) return unauthorizedTechnicalResponse(request);
  let selectedEnvironment: ReturnType<typeof melhorEnvioEnvironment>;
  try { selectedEnvironment = melhorEnvioEnvironment(); }
  catch {
    return NextResponse.json({ message: "Configuração do Melhor Envio inválida.",
      panelConfiguration: getMelhorEnvioReadiness(process.env) }, { status: 503, headers: technicalNoStore });
  }
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.json({ message: "Integração indisponível." }, { status: 503, headers: technicalNoStore });
  const credential = await db.rpc("read_integration_credential", { p_provider: "melhorenvio", p_environment: selectedEnvironment });
  if (credential.error) return NextResponse.json({ message: "Status da integração indisponível." }, { status: 503, headers: technicalNoStore });
  const row = credential.data && typeof credential.data === "object" && !Array.isArray(credential.data)
    ? credential.data as Record<string, unknown> : null;
  const connected = row?.status === "connected";
  const panelConfiguration = getMelhorEnvioReadiness(process.env);
  const originMissingFields = melhorEnvioOriginMissingFields();

  const started = Date.now();
  let health = "not_configured";
  let failure: MelhorEnvioFailureDetails = {};
  if (connected) {
    try {
      const checked = await panelMelhorEnvioProvider().healthCheck();
      health = checked.state;
      failure = checked.failure ?? {};
    } catch { health = "offline"; }
  }
  const latencyMs = Date.now() - started;
  // Diagnóstico da chave após o teste (que pode ter recifrado o registro): só classes, nunca valores.
  let tokenKeys: MelhorEnvioCredentialKeyReport | null = null;
  if (connected) {
    try {
      const latest = await db.rpc("read_integration_credential", { p_provider: "melhorenvio", p_environment: selectedEnvironment });
      const current = !latest.error && latest.data && typeof latest.data === "object" && !Array.isArray(latest.data)
        ? latest.data as Record<string, unknown> : null;
      if (current?.status === "connected") {
        tokenKeys = await inspectMelhorEnvioCredentialKeys({
          accessTokenCiphertext: text(current.access_token_ciphertext),
          refreshTokenCiphertext: text(current.refresh_token_ciphertext)
        }, panelMelhorEnvioTokenKeyring());
      }
    } catch { tokenKeys = null; }
  }
  const checkedAt = new Date().toISOString();
  const lastError = health === "online" || !connected ? null : failure.reason ?? "connection_check_failed";
  await db.from("integration_health").upsert({ provider: "melhorenvio", state: health, checked_at: checkedAt,
    latency_ms: latencyMs, error_summary: lastError,
    metadata_sanitized: { scope: "panel_oauth", environment: selectedEnvironment, connected,
      webhookConfigured: process.env.MELHOR_ENVIO_WEBHOOK_CONFIGURED === "true",
      originComplete: originMissingFields.length === 0,
      ...(failure.reason ? { reason: failure.reason } : {}),
      ...(failure.upstreamStatus ? { upstreamStatus: failure.upstreamStatus } : {}),
      ...(tokenKeys ? { tokenKeyId: tokenKeys.activeKeyId, tokenReencryptionPending: tokenKeys.reencryptionPending } : {}) }
  }, { onConflict: "provider" });
  const storeHealth = await db.from("integration_health")
    .select("provider,state,checked_at,latency_ms,error_summary,metadata_sanitized")
    .eq("provider", "melhorenvio_store").maybeSingle();
  const storeShipping = getStoreShippingService(storeHealth.data, Boolean(storeHealth.error));
  const storeMetadata: unknown = storeHealth.data?.metadata_sanitized;
  const storeEnvironment = storeMetadata && typeof storeMetadata === "object" && !Array.isArray(storeMetadata)
    ? (storeMetadata as Record<string, unknown>).environment : null;
  const storeCheckAge = Date.now() - Date.parse(storeShipping.checkedAt ?? "");
  const storeRecentlyVerified = Number.isFinite(storeCheckAge) && storeCheckAge >= 0 && storeCheckAge <= 5 * 60_000;
  // A chave anterior só pode sair quando o registro está na chave ativa e loja e painel provaram usá-la.
  const sameActiveKey = Boolean(tokenKeys && storeShipping.tokenKeyId === tokenKeys.activeKeyId
    && storeEnvironment === selectedEnvironment);
  const keyRotation = tokenKeys ? {
    activeKeyId: tokenKeys.activeKeyId,
    previousKeyCount: tokenKeys.previousKeyCount,
    accessToken: tokenKeys.accessToken,
    refreshToken: tokenKeys.refreshToken,
    readable: tokenKeys.readable,
    reencryptionPending: tokenKeys.reencryptionPending,
    storeActiveKeyId: storeShipping.tokenKeyId ?? null,
    sameActiveKey,
    previousKeysRemovable: tokenKeys.readable && !tokenKeys.reencryptionPending
      && tokenKeys.accessToken === "active" && tokenKeys.refreshToken === "active"
      && sameActiveKey && storeRecentlyVerified && storeShipping.state === "online" && health === "online"
  } : null;
  return NextResponse.json({ environment: selectedEnvironment, connected, health, latencyMs,
    storeShipping,
    panelConfiguration,
    accessTokenExpiresAt: connected && typeof row?.access_token_expires_at === "string" ? row.access_token_expires_at : null,
    webhookConfigured: process.env.MELHOR_ENVIO_WEBHOOK_CONFIGURED === "true",
    originComplete: originMissingFields.length === 0, originMissingFields, lastCheckedAt: checkedAt, lastError,
    lastErrorDetail: melhorEnvioFailureLabel(failure.reason), upstreamStatus: failure.upstreamStatus ?? null,
    keyRotation }, { headers: technicalNoStore });
}
