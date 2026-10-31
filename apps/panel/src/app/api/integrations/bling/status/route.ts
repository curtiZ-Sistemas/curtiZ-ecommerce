import { type NextRequest, NextResponse } from "next/server";
import { safeTechnicalOrigin, technicalNoStore, unauthorizedTechnicalResponse } from "@/lib/technical-api";
import { authorizeBlingTechnicalRequest, blingConfigured, blingEnvironment, panelBlingClient } from "@/lib/bling-server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const auth = await authorizeBlingTechnicalRequest(request, { mutation: false });
  if (!auth) return unauthorizedTechnicalResponse(request);
  const configured = blingConfigured();
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.json({ message: "Banco indisponível." }, { status: 503, headers: technicalNoStore });
  const [credential, account, metrics] = await Promise.all([
    db.rpc("read_integration_credential", { p_provider: "bling", p_environment: blingEnvironment() }),
    db.rpc("read_bling_account", { p_environment: blingEnvironment() }),
    db.rpc("read_bling_operational_status")
  ]);
  if (credential.error || account.error || metrics.error)
    return NextResponse.json({ message: "Status do Bling indisponível." }, { status: 503, headers: technicalNoStore });
  const row = credential.data && typeof credential.data === "object" && !Array.isArray(credential.data)
    ? credential.data as Record<string, unknown> : null;
  const connected = configured && row?.status === "connected";
  const expiry = connected && typeof row?.access_token_expires_at === "string" ? row.access_token_expires_at : null;
  const expiresSoon = expiry ? Date.parse(expiry) <= Date.now() + 10 * 60_000 : false;
  const summary = metrics.data && typeof metrics.data === "object" && !Array.isArray(metrics.data)
    ? metrics.data as Record<string, unknown> : {};
  const lastWebhookAt = typeof summary.lastWebhookAt === "string" ? summary.lastWebhookAt : null;
  const webhookConfigured = process.env.BLING_WEBHOOK_CONFIGURED === "true";
  const accountRow = account.data && typeof account.data === "object" && !Array.isArray(account.data)
    ? account.data as Record<string, unknown> : null;
  const webhookReference = lastWebhookAt ?? (typeof accountRow?.verifiedAt === "string" ? accountRow.verifiedAt : null);
  const webhookStale = webhookConfigured && webhookReference !== null && Date.now() - Date.parse(webhookReference) > 48 * 60 * 60_000;
  const status = !configured ? "not_configured" : row?.status === "refresh_required" ? "reconnect_required"
    : !connected ? "awaiting_connection" : Number(summary.failed) > 0 || accountRow?.apiHealthy === false ? "degraded"
      : !webhookConfigured || webhookStale ? "webhook_pending" : expiresSoon ? "token_expiring" : "connected";
  return NextResponse.json({ status, connected, environment: blingEnvironment(),
    apiCheckedAt: accountRow?.apiCheckedAt ?? null, apiHealthy: accountRow?.apiHealthy ?? null,
    scopeSetup: ["Empresa", "Contatos", "Produtos", "Estoques", "Pedidos de venda", "NF-e", "Naturezas de operação"],
    companyName: connected && typeof accountRow?.companyName === "string" ? accountRow.companyName : null,
    accessTokenExpiresAt: expiry, webhookConfigured, webhookStale,
    orderSyncEnabled: process.env.BLING_ORDER_SYNC_ENABLED === "true",
    invoiceSyncEnabled: process.env.BLING_INVOICE_SYNC_ENABLED === "true",
    invoiceSendEnabled: process.env.BLING_INVOICE_SEND_ENABLED === "true",
    fiscalReady: process.env.BLING_FISCAL_READY === "true",
    productSyncEnabled: process.env.BLING_PRODUCT_SYNC_ENABLED === "true",
    productCreateEnabled: process.env.BLING_PRODUCT_CREATE_ENABLED === "true",
    stockSyncEnabled: process.env.BLING_STOCK_SYNC_ENABLED === "true",
    stockDepositConfigured: /^\d+$/u.test(process.env.BLING_STOCK_DEPOSIT_ID?.trim() ?? ""),
    metrics: summary }, { headers: technicalNoStore });
}

export async function POST(request: NextRequest) {
  if (!safeTechnicalOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: technicalNoStore });
  const auth = await authorizeBlingTechnicalRequest(request);
  if (!auth) return unauthorizedTechnicalResponse(request);
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.json({ message: "Integração indisponível." }, { status: 503, headers: technicalNoStore });
  try {
    const result = await panelBlingClient(db).request("/empresas/me/dados-basicos") as { data?: { id?: unknown } };
    const account = await db.rpc("read_bling_account", { p_environment: blingEnvironment() });
    const accountData: unknown = account.data;
    const verified = accountData && typeof accountData === "object" && "companyId" in accountData && typeof accountData.companyId === "string"
      ? accountData.companyId : "";
    if (account.error || !verified || String(result.data?.id) !== verified) throw new Error("company_mismatch");
    await db.rpc("record_bling_api_health", { p_environment: blingEnvironment(), p_healthy: true });
    return NextResponse.json({ ok: true }, { headers: technicalNoStore });
  } catch {
    await db.rpc("record_bling_api_health", { p_environment: blingEnvironment(), p_healthy: false });
    return NextResponse.json({ message: "Não foi possível confirmar a conexão." }, { status: 503, headers: technicalNoStore });
  }
}
