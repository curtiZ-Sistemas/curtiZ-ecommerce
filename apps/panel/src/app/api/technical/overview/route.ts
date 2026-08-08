import { type NextRequest, NextResponse } from "next/server";
import {
  authorizeTechnicalRequest,
  sanitizeTechnicalValue,
  technicalNoStore,
  technicalRows,
  unauthorizedTechnicalResponse
} from "@/lib/technical-api";

export const dynamic = "force-dynamic";

type ServiceState = "online" | "degraded" | "offline" | "configured" | "not_configured" | "mock" | "unavailable";
type Service = { name: string; state: ServiceState; detail: string; checkedAt?: string | null; latencyMs?: number | null };

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function configured(condition: boolean): ServiceState {
  return condition ? "configured" : "not_configured";
}

async function checkStore(): Promise<Service> {
  const rawUrl = process.env.NEXT_PUBLIC_STORE_URL;
  if (!rawUrl) return { name: "Loja", state: "not_configured", detail: "URL da loja ausente" };
  try {
    const url = new URL(rawUrl);
    if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("invalid_protocol");
    const startedAt = Date.now();
    const response = await fetch(url.origin, {
      method: "HEAD",
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(4_000)
    });
    const latencyMs = Date.now() - startedAt;
    return {
      name: "Loja",
      state: response.status < 500 ? (latencyMs > 2_000 ? "degraded" : "online") : "offline",
      detail: `HTTP ${response.status}`,
      checkedAt: new Date().toISOString(),
      latencyMs
    };
  } catch {
    return { name: "Loja", state: "unavailable", detail: "Verificação remota indisponível" };
  }
}

export async function GET(request: NextRequest) {
  const auth = await authorizeTechnicalRequest(request);
  if (!auth) return unauthorizedTechnicalResponse();

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [
    store,
    integrations,
    recentErrors,
    openErrors,
    pendingJobs,
    runningJobs,
    failedJobs,
    failedWebhooks,
    securityEvents,
    flags,
    storage,
    database
  ] = await Promise.all([
    checkStore(),
    auth.supabase.from("integration_health").select("provider,state,checked_at,latency_ms,error_summary,metadata_sanitized").order("provider"),
    auth.supabase.from("technical_events").select("id", { count: "exact", head: true }).in("severity", ["error", "critical", "fatal"]).gte("created_at", since),
    auth.supabase.from("technical_events").select("id", { count: "exact", head: true }).in("severity", ["error", "critical", "fatal"]).neq("resolution_status", "resolved"),
    auth.supabase.from("background_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
    auth.supabase.from("background_jobs").select("id", { count: "exact", head: true }).eq("status", "running"),
    auth.supabase.from("background_jobs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    auth.supabase.from("payment_events").select("id", { count: "exact", head: true }).in("processing_status", ["failed", "error"]),
    auth.supabase.from("security_events").select("id", { count: "exact", head: true }).gte("created_at", since),
    auth.supabase.from("feature_flags").select("key,enabled", { count: "exact" }),
    auth.supabase.rpc("technical_storage_summary"),
    auth.supabase.rpc("technical_database_summary")
  ]);

  const databaseAvailable = !integrations.error && !recentErrors.error && !pendingJobs.error;
  const persistedServices: Service[] = technicalRows(integrations.data).map((item) => ({
    name: typeof item.provider === "string" ? item.provider : "Integração",
    state: ["online", "degraded", "offline", "not_configured", "maintenance", "awaiting_credentials"].includes(String(item.state))
      ? (item.state === "maintenance" ? "degraded" : item.state === "awaiting_credentials" ? "not_configured" : item.state) as ServiceState
      : "unavailable",
    detail: typeof item.error_summary === "string" ? item.error_summary : "Estado persistido pelo serviço",
    checkedAt: typeof item.checked_at === "string" ? item.checked_at : null,
    latencyMs: typeof item.latency_ms === "number" ? item.latency_ms : null
  }));

  const whatsappProvider = process.env.WHATSAPP_PROVIDER?.toLowerCase() ?? "disabled";
  const shippingProvider = process.env.SHIPPING_PROVIDER?.toLowerCase() ?? "disabled";
  const marketingProvider = process.env.MARKETING_PROVIDER?.toLowerCase() ?? "disabled";
  const environmentServices: Service[] = [
    { name: "Painel", state: "online", detail: "Esta API respondeu com sessão técnica válida", checkedAt: new Date().toISOString() },
    store,
    { name: "Supabase / Banco", state: databaseAvailable ? "online" : "unavailable", detail: databaseAvailable ? "Consultas protegidas responderam" : "Consulta protegida falhou", checkedAt: new Date().toISOString() },
    { name: "Auth", state: "online", detail: "Sessão validada pelo Supabase Auth", checkedAt: new Date().toISOString() },
    { name: "Cloudflare", state: configured((process.env.NEXT_PUBLIC_PANEL_URL ?? "").includes("workers.dev")), detail: "Estado inferido apenas da configuração de runtime" },
    { name: "Mercado Pago", state: configured(enabled(process.env.MERCADO_PAGO_ENABLED) && Boolean(process.env.MERCADO_PAGO_ACCESS_TOKEN) && Boolean(process.env.MERCADO_PAGO_WEBHOOK_SECRET)), detail: enabled(process.env.MERCADO_PAGO_ENABLED) ? "Provider habilitado; credenciais não são exibidas" : "Provider desabilitado" },
    { name: "Resend", state: configured(enabled(process.env.EMAIL_ENABLED) && Boolean(process.env.RESEND_API_KEY)), detail: enabled(process.env.EMAIL_ENABLED) ? "E-mail habilitado; credencial não é exibida" : "E-mail desabilitado" },
    { name: "Frete", state: shippingProvider === "mock" ? "mock" : configured(shippingProvider !== "disabled" && (Boolean(process.env.MELHOR_ENVIO_ACCESS_TOKEN) || Boolean(process.env.CORREIOS_API_TOKEN))), detail: shippingProvider === "mock" ? "Modo mock explicitamente configurado" : `Provider: ${shippingProvider}` },
    { name: "WhatsApp", state: whatsappProvider === "mock" ? "mock" : configured(whatsappProvider === "meta" && Boolean(process.env.WHATSAPP_ACCESS_TOKEN)), detail: whatsappProvider === "mock" ? "Modo mock explicitamente configurado" : `Provider: ${whatsappProvider}` },
    { name: "Turnstile", state: configured(enabled(process.env.TURNSTILE_ENABLED) && Boolean(process.env.TURNSTILE_SECRET_KEY)), detail: enabled(process.env.TURNSTILE_ENABLED) ? "Proteção habilitada; segredo não é exibido" : "Proteção desabilitada" },
    { name: "Marketing", state: marketingProvider === "mock" ? "mock" : configured(marketingProvider !== "disabled"), detail: `Provider: ${marketingProvider}` }
  ];

  const serviceNames = new Set(environmentServices.map((service) => service.name.toLocaleLowerCase("pt-BR")));
  const services = [...environmentServices, ...persistedServices.filter((service) => !serviceNames.has(service.name.toLocaleLowerCase("pt-BR")))];
  const storageData: unknown = storage.data;

  return NextResponse.json(
    {
      services: sanitizeTechnicalValue(services),
      metrics: {
        recentErrors: recentErrors.count ?? 0,
        openErrors: openErrors.count ?? 0,
        pendingJobs: pendingJobs.count ?? 0,
        runningJobs: runningJobs.count ?? 0,
        failedJobs: failedJobs.count ?? 0,
        failedWebhooks: failedWebhooks.count ?? 0,
        recentSecurityEvents: securityEvents.count ?? 0,
        featureFlags: flags.count ?? 0,
        enabledFeatureFlags: technicalRows(flags.data).filter((item) => item.enabled === true).length
      },
      storage: sanitizeTechnicalValue(storageData),
      database: sanitizeTechnicalValue(database.data),
      runtime: {
        environment: process.env.APP_ENV ?? "não configurado",
        version: process.env.APP_VERSION ?? "não configurada",
        commit: process.env.GIT_COMMIT_SHA ?? process.env.CF_PAGES_COMMIT_SHA ?? null,
        backup: process.env.BACKUP_PROVIDER ? "configurado" : "não configurado",
        databaseDiagnostics: "Conexões, índices e SQL arbitrário não são expostos ao navegador."
      }
    },
    { headers: technicalNoStore }
  );
}
