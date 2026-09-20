"use client";

import { Activity, Boxes, Database, LoaderCircle, RefreshCw, ShieldAlert, Webhook } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type RecordValue = Record<string, unknown>;
type Service = { name: string; state: string; detail: string; checkedAt?: string | null; latencyMs?: number | null };
type StorageSummary = { bucket_id: string; object_count: number; total_bytes: number };
type MelhorEnvioStatus = { environment: string; connected: boolean; health: string; latencyMs: number;
  accessTokenExpiresAt: string | null; webhookConfigured: boolean; originComplete: boolean; originMissingFields: string[];
  lastCheckedAt: string; lastError: string | null };

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function metricValue(value: unknown): number | string {
  return typeof value === "number" && Number.isFinite(value) ? value : "—";
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseServices(value: unknown): Service[] {
  return Array.isArray(value)
    ? value.flatMap((item) => isRecord(item) && typeof item.name === "string" && typeof item.state === "string" && typeof item.detail === "string"
      ? [{ name: item.name, state: item.state, detail: item.detail, checkedAt: typeof item.checkedAt === "string" ? item.checkedAt : null, latencyMs: typeof item.latencyMs === "number" ? item.latencyMs : null }]
      : [])
    : [];
}

function parseStorage(value: unknown): StorageSummary[] {
  return Array.isArray(value)
    ? value.flatMap((item) => isRecord(item) && typeof item.bucket_id === "string"
      ? [{ bucket_id: item.bucket_id, object_count: numberValue(item.object_count), total_bytes: numberValue(item.total_bytes) }]
      : [])
    : [];
}

const stateLabels: Record<string, string> = {
  online: "Conectado",
  degraded: "Degradado",
  offline: "Com erro",
  configured: "Configurado",
  not_configured: "Não configurado",
  mock: "Modo mock",
  unavailable: "Indisponível"
};

const bytes = new Intl.NumberFormat("pt-BR", { notation: "compact", style: "unit", unit: "byte", unitDisplay: "narrow" });
const formatDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Indisponível" : date.toLocaleString("pt-BR");
};
const tokenState = (status: MelhorEnvioStatus) => {
  if (!status.connected) return "Ausente";
  const expiresAt = status.accessTokenExpiresAt ? Date.parse(status.accessTokenExpiresAt) : Number.NaN;
  return status.health === "online" || Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000
    ? "Válido" : "Renovação necessária";
};

export function TechnicalOverview({ section }: { section: string }) {
  const [services, setServices] = useState<Service[]>([]);
  const [metrics, setMetrics] = useState<RecordValue>({});
  const [storage, setStorage] = useState<StorageSummary[]>([]);
  const [database, setDatabase] = useState<RecordValue>({});
  const [runtime, setRuntime] = useState<RecordValue>({});
  const [deployments, setDeployments] = useState<RecordValue>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [melhorEnvio, setMelhorEnvio] = useState<MelhorEnvioStatus | null>(null);
  const [integrationBusy, setIntegrationBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    setWarning("");
    try {
      const response = await fetch("/api/technical/overview", { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok || !isRecord(payload)) throw new Error("load_failed");
      setServices(parseServices(payload.services));
      setMetrics(isRecord(payload.metrics) ? payload.metrics : {});
      setStorage(parseStorage(payload.storage));
      setDatabase(isRecord(payload.database) ? payload.database : {});
      setRuntime(isRecord(payload.runtime) ? payload.runtime : {});
      setDeployments(isRecord(payload.deployments) ? payload.deployments : {});
      try {
        const integrationResponse = await fetch("/api/integrations/melhor-envio/status", { cache: "no-store" });
        if (integrationResponse.ok) setMelhorEnvio(await integrationResponse.json() as MelhorEnvioStatus);
        else setMelhorEnvio(null);
      } catch { setMelhorEnvio(null); }
      setWarning(
        Array.isArray(payload.unavailable) && payload.unavailable.length > 0
          ? `Dados temporariamente indisponíveis: ${payload.unavailable.filter((item): item is string => typeof item === "string").join(", ")}.`
          : ""
      );
    } catch {
      setServices([]);
      setMetrics({});
      setStorage([]);
      setDatabase({});
      setRuntime({});
      setDeployments({});
      setMessage("Não foi possível verificar os serviços técnicos agora.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const showServices = !section || ["saude-servicos", "supabase", "banco-dados", "configuracoes-tecnicas"].includes(section);
  const showStorage = !section || ["storage", "integridade-dados"].includes(section);
  const showDatabase = !section || ["banco-dados", "supabase", "integridade-dados"].includes(section);
  const showRuntime = !section || ["backups", "deploys", "versoes", "banco-dados", "configuracoes-tecnicas"].includes(section);
  const showSessionNote = section === "sessoes";
  const showIntegrations = !section || ["integracoes", "configuracoes-tecnicas", "saude-servicos"].includes(section);

  const connectMelhorEnvio = async () => {
    setIntegrationBusy(true); setMessage("");
    try {
      const response = await fetch("/api/integrations/melhor-envio/connect", { method: "POST" });
      const payload = await response.json() as { authorizationUrl?: string; message?: string };
      if (!response.ok || !payload.authorizationUrl || !/^https:\/\/(sandbox\.)?melhorenvio\.com\.br\/oauth\/authorize/u.test(payload.authorizationUrl)) {
        throw new Error(payload.message || "Não foi possível iniciar a conexão.");
      }
      window.location.assign(payload.authorizationUrl);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível iniciar a conexão."); setIntegrationBusy(false); }
  };

  const disconnectMelhorEnvio = async () => {
    if (!window.confirm("Desconectar o Melhor Envio? Novas cotações ficarão indisponíveis.")) return;
    setIntegrationBusy(true); setMessage("");
    try {
      const response = await fetch("/api/integrations/melhor-envio/disconnect", { method: "POST" });
      if (!response.ok) throw new Error("Não foi possível desconectar a integração.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível desconectar a integração."); }
    finally { setIntegrationBusy(false); }
  };

  return (
    <div className="technical-overview">
      <div className="technical-toolbar">
        <p>Estados obtidos de verificações reais, consultas protegidas ou configuração do runtime.</p>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "spin" : ""} aria-hidden="true" /> Verificar agora
        </button>
      </div>
      {message ? <p className="admin-feedback" role="alert">{message}</p> : null}
      {warning ? <p className="admin-feedback" role="alert">{warning}</p> : null}

      <div className="technical-metric-grid" aria-busy={loading}>
        <TechnicalMetric icon={<ShieldAlert />} label="Erros nas últimas 24h" value={loading ? "—" : metricValue(metrics.recentErrors)} />
        <TechnicalMetric icon={<Activity />} label="Erros abertos" value={loading ? "—" : metricValue(metrics.openErrors)} />
        <TechnicalMetric icon={<Boxes />} label="Jobs pendentes" value={loading ? "—" : metricValue(metrics.pendingJobs)} />
        <TechnicalMetric icon={<Boxes />} label="Jobs falhos" value={loading ? "—" : metricValue(metrics.failedJobs)} />
        <TechnicalMetric icon={<Webhook />} label="Webhooks falhos" value={loading ? "—" : metricValue(metrics.failedWebhooks)} />
        <TechnicalMetric icon={<ShieldAlert />} label="Eventos de segurança 24h" value={loading ? "—" : metricValue(metrics.recentSecurityEvents)} />
      </div>

      {showServices ? (
        <section className="panel-card technical-section">
          <h2>Saúde dos serviços</h2>
          {loading ? <div className="admin-loading"><LoaderCircle className="spin" /> Verificando</div> : services.length === 0 ? <p className="admin-empty-copy">{message ? "Consulta de serviços indisponível." : "Nenhum estado de serviço disponível."}</p> : (
            <div className="technical-service-grid">
              {services.map((service) => (
                <article key={service.name}>
                  <header><strong>{service.name}</strong><span className={`status technical-${service.state}`}>{stateLabels[service.state] ?? service.state}</span></header>
                  <p>{service.detail}</p>
                  <small>{service.latencyMs !== null && service.latencyMs !== undefined ? `${service.latencyMs} ms` : "Latência não disponível"}</small>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {showStorage ? (
        <section className="panel-card technical-section">
          <h2><Database aria-hidden="true" /> Storage</h2>
          {storage.length === 0 ? <p className="admin-empty-copy">{message || warning.includes("storage") ? "Resumo de storage indisponível." : "Nenhum bucket criado."}</p> : (
            <div className="admin-compact-list">{storage.map((bucket) => <div key={bucket.bucket_id}><span><strong>{bucket.bucket_id}</strong><small>{bucket.object_count.toLocaleString("pt-BR")} arquivo(s)</small></span><strong>{bytes.format(bucket.total_bytes)}</strong></div>)}</div>
          )}
          <p className="technical-note">Somente totais agregados são exibidos; caminhos e arquivos privados não são expostos.</p>
        </section>
      ) : null}

      {showIntegrations ? <section className="panel-card technical-section">
        <h2><Webhook aria-hidden="true" /> Melhor Envio</h2>
        {!melhorEnvio ? <p className="admin-empty-copy">Status detalhado indisponível.</p> : <>
          <div className="technical-runtime-grid">
            <Runtime label="Ambiente" value={melhorEnvio.environment === "production" ? "Produção" : "Sandbox"} />
            <Runtime label="Conexão" value={melhorEnvio.connected ? "Conectado" : "Não conectado"} />
            <Runtime label="Token" value={tokenState(melhorEnvio)} />
            <Runtime label="Webhook" value={melhorEnvio.webhookConfigured ? "Configurado" : "Pendente"} />
            <Runtime label="Origem" value={melhorEnvio.originComplete ? "Completa" : "Incompleta"} />
            <Runtime label="Latência" value={`${melhorEnvio.latencyMs} ms`} />
            <Runtime label="Última comunicação" value={formatDateTime(melhorEnvio.lastCheckedAt)} />
            <Runtime label="Último erro" value={melhorEnvio.lastError ?? "Nenhum"} />
          </div>
          <div className="table-actions">
            <button className="secondary-button" type="button" disabled={integrationBusy} onClick={() => void load()}>Testar conexão</button>
            {!melhorEnvio.connected
              ? <button className="primary-button" type="button" disabled={integrationBusy} onClick={() => void connectMelhorEnvio()}>Conectar</button>
              : <button className="secondary-button" type="button" disabled={integrationBusy} onClick={() => void disconnectMelhorEnvio()}>Desconectar</button>}
          </div>
          {!melhorEnvio.originComplete && melhorEnvio.originMissingFields.length > 0
            ? <p className="technical-note">Configuração de origem pendente: {melhorEnvio.originMissingFields.join(", ")}.</p>
            : null}
          <p className="technical-note">Tokens, secrets e assinaturas nunca são exibidos.</p>
        </>}
      </section> : null}

      {showDatabase ? (
        <section className="panel-card technical-section">
          <h2><Database aria-hidden="true" /> Banco e integridade</h2>
          {Object.keys(database).length === 0 ? <p className="admin-empty-copy">Diagnóstico agregado indisponível.</p> : (
            <div className="technical-runtime-grid">
              <Runtime label="Versão do PostgreSQL" value={textValue(database.server_version) || "Indisponível"} />
              <Runtime label="Última migration" value={textValue(database.last_migration) || "Indisponível"} />
              <Runtime label="Conexões ativas" value={numberValue(database.active_connections).toLocaleString("pt-BR")} />
              <Runtime label="Tamanho do banco" value={bytes.format(numberValue(database.database_size_bytes))} />
              <Runtime label="Tabelas públicas" value={numberValue(database.public_tables).toLocaleString("pt-BR")} />
              <Runtime label="Índices públicos" value={numberValue(database.public_indexes).toLocaleString("pt-BR")} />
            </div>
          )}
          <p className="technical-note">Diagnóstico somente leitura e agregado. O painel não oferece execução de SQL arbitrário.</p>
        </section>
      ) : null}

      {showSessionNote ? (
        <section className="panel-card technical-section">
          <h2>Sessões e autenticação</h2>
          <p className="technical-note">A sessão atual foi validada pelo Supabase Auth. Tokens, cookies e sessões de outros usuários não são expostos no navegador.</p>
        </section>
      ) : null}

      {showRuntime ? (
        <section className="panel-card technical-section">
          <h2>Runtime, deploy e manutenção</h2>
          {!message ? (
            <div className="technical-deploy-grid">
              <DeploymentCard label="Loja" value={deployments.store} />
              <DeploymentCard label="Painel" value={deployments.panel} />
            </div>
          ) : null}
          {message ? <p className="admin-empty-copy">Configuração de runtime indisponível.</p> : <div className="technical-runtime-grid">
            <Runtime label="Ambiente" value={textValue(runtime.environment) || "Não configurado"} />
            <Runtime label="Versão" value={textValue(runtime.version) || "Metadados de versão não informados"} />
            <Runtime label="Backups" value={textValue(runtime.backup) || "Não configurado"} />
          </div>}
          {!message ? <p className="technical-note">{textValue(runtime.databaseDiagnostics)}</p> : null}
        </section>
      ) : null}
    </div>
  );
}

function TechnicalMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return <article className="admin-metric">{icon}<span>{label}</span><strong>{typeof value === "number" ? value.toLocaleString("pt-BR") : value}</strong></article>;
}

function Runtime({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function DeploymentCard({ label, value }: { label: string; value: unknown }) {
  const deployment = isRecord(value) ? value : {};
  return (
    <article>
      <h3>{label}</h3>
      <dl>
        <div><dt>Ambiente</dt><dd>{textValue(deployment.environment) || "Não informado"}</dd></div>
        <div><dt>Commit</dt><dd>{textValue(deployment.commit) || "Não informado"}</dd></div>
        <div><dt>Build</dt><dd>{textValue(deployment.build) || "Metadados de build não informados"}</dd></div>
        <div><dt>Gerado em</dt><dd>{textValue(deployment.builtAt) || "Não informado"}</dd></div>
      </dl>
    </article>
  );
}
