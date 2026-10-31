"use client";

import { RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { BlingIntegration } from "./bling-integration";
import { usePanelConfirm } from "./panel-prompt";
import { Kpi, KpiStrip, LoadingBlock, SectionHeader, StateMessage, StatusLabel, type UiTone } from "./panel-ui";

type RecordValue = Record<string, unknown>;
type Service = { name: string; state: string; detail: string; checkedAt?: string | null; latencyMs?: number | null };
type StorageSummary = { bucket_id: string; object_count: number; total_bytes: number };
type MelhorEnvioStatus = { environment: string; connected: boolean; health: string; latencyMs: number;
  accessTokenExpiresAt: string | null; webhookConfigured: boolean; originComplete: boolean; originMissingFields: string[];
  lastCheckedAt: string; lastError: string | null; lastErrorDetail?: string | null; storeShipping?: Service;
  keyRotation?: KeyRotation | null };
type KeyState = "active" | "previous" | "unavailable" | "invalid";
type KeyRotation = { activeKeyId: string; previousKeyCount: number; accessToken: KeyState; refreshToken: KeyState;
  readable: boolean; reencryptionPending: boolean; storeActiveKeyId: string | null; sameActiveKey: boolean;
  previousKeysRemovable: boolean };

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

const stateTones: Record<string, UiTone> = {
  online: "success",
  configured: "success",
  degraded: "warning",
  mock: "warning",
  offline: "danger"
};

const bytes = new Intl.NumberFormat("pt-BR", { notation: "compact", style: "unit", unit: "byte", unitDisplay: "narrow" });
const formatDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Indisponível" : date.toLocaleString("pt-BR");
};
const tokenState = (status: MelhorEnvioStatus) => {
  if (!status.connected) return "Ausente";
  const expiresAt = status.accessTokenExpiresAt ? Date.parse(status.accessTokenExpiresAt) : Number.NaN;
  if (status.health === "online") return "Verificado no painel";
  return Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000
    ? "Dentro do prazo; comunicação não verificada" : "Renovação necessária";
};

const keyRotationState = (rotation: KeyRotation | null | undefined) => {
  if (!rotation) return "Não verificada";
  if (!rotation.readable) return [rotation.accessToken, rotation.refreshToken].includes("unavailable")
    ? "Chave que cifrou os tokens ausente" : "Tokens não decifram com as chaves configuradas";
  if (rotation.reencryptionPending) return "Legível com chave anterior; recifragem pendente";
  return `Chave ativa ${rotation.activeKeyId}`;
};
const keyRotationNote = (rotation: KeyRotation) => {
  if (!rotation.readable) return "Configure a chave anterior em MELHOR_ENVIO_TOKEN_ENCRYPTION_PREVIOUS_KEYS na loja e no painel ou, se ela foi perdida, reconecte o OAuth. Os tokens atuais não são apagados até a nova conexão ser confirmada.";
  if (rotation.previousKeysRemovable) return rotation.previousKeyCount > 0
    ? "Loja e painel usam a mesma chave ativa e os tokens já foram recifrados: a chave anterior pode ser removida dos dois Workers."
    : "Loja e painel usam a mesma chave ativa.";
  if (!rotation.sameActiveKey) return rotation.storeActiveKeyId
    ? `A loja registrou a chave ativa ${rotation.storeActiveKeyId}; mantenha a chave anterior até as duas coincidirem.`
    : "A loja ainda não registrou uma cotação bem-sucedida com a chave ativa; mantenha a chave anterior até lá.";
  return "Mantenha a chave anterior até a recifragem e uma cotação bem-sucedida da loja.";
};

export function TechnicalOverview({ section }: { section: string }) {
  const confirm = usePanelConfirm();
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
  // Falhas de conectar/desconectar ficam no bloco da integração e não escondem os demais diagnósticos.
  const [integrationMessage, setIntegrationMessage] = useState("");

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

  const connectMelhorEnvio = async (reconnect: boolean) => {
    const confirmed = await confirm(reconnect
      ? {
        title: "Reconectar o Melhor Envio?",
        description: "Você será levado ao Melhor Envio para autorizar de novo. Os tokens atuais continuam guardados até a nova autorização ser confirmada.",
        confirmLabel: "Reconectar"
      }
      : {
        title: "Conectar o Melhor Envio?",
        description: "Você será levado ao Melhor Envio para autorizar o acesso do painel.",
        confirmLabel: "Conectar"
      });
    if (!confirmed) return;
    setIntegrationBusy(true); setIntegrationMessage("");
    try {
      const response = await fetch("/api/integrations/melhor-envio/connect", { method: "POST" });
      const payload = await response.json() as { authorizationUrl?: string; message?: string };
      if (!response.ok || !payload.authorizationUrl || !/^https:\/\/(sandbox\.)?melhorenvio\.com\.br\/oauth\/authorize/u.test(payload.authorizationUrl)) {
        throw new Error(payload.message || "Não foi possível iniciar a conexão.");
      }
      window.location.assign(payload.authorizationUrl);
    } catch (error) { setIntegrationMessage(error instanceof Error ? error.message : "Não foi possível iniciar a conexão."); setIntegrationBusy(false); }
  };

  const disconnectMelhorEnvio = async () => {
    const confirmed = await confirm({
      title: "Desconectar o Melhor Envio?",
      description: "Novas cotações ficarão indisponíveis.",
      confirmLabel: "Desconectar",
      tone: "danger"
    });
    if (!confirmed) return;
    setIntegrationBusy(true); setIntegrationMessage("");
    try {
      const response = await fetch("/api/integrations/melhor-envio/disconnect", { method: "POST" });
      if (!response.ok) throw new Error("Não foi possível desconectar a integração.");
      await load();
    } catch (error) { setIntegrationMessage(error instanceof Error ? error.message : "Não foi possível desconectar a integração."); }
    finally { setIntegrationBusy(false); }
  };

  const kpiValue = (value: unknown) => loading ? <span className="ui-skeleton technical-kpi-skeleton" aria-hidden="true" /> : formatMetric(metricValue(value));
  const kpiTone = (value: unknown, attention: UiTone): UiTone => !loading && numberValue(value) > 0 ? attention : "neutral";
  const kpiDetail = (value: unknown, positive: string) => {
    if (loading) return undefined;
    const current = metricValue(value);
    if (typeof current !== "number") return "Indisponível";
    return current > 0 ? positive : "Nenhum registro";
  };

  return (
    <div className="technical-overview">
      <div className="technical-toolbar">
        <p>Estados obtidos de verificações reais, consultas protegidas ou configuração do runtime.</p>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "spin" : ""} aria-hidden="true" /> Verificar agora
        </button>
      </div>
      {message ? (
        <div className="admin-feedback error technical-alert" role="alert">
          <p>{message}</p>
          <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>Tentar novamente</button>
        </div>
      ) : null}
      {warning ? <p className="admin-feedback warning" role="status">{warning}</p> : null}

      <KpiStrip label="Indicadores técnicos" busy={loading}>
        <Kpi label="Erros nas últimas 24h" value={kpiValue(metrics.recentErrors)} tone={kpiTone(metrics.recentErrors, "warning")} detail={kpiDetail(metrics.recentErrors, "Registrados no período")} />
        <Kpi label="Erros abertos" value={kpiValue(metrics.openErrors)} tone={kpiTone(metrics.openErrors, "warning")} detail={kpiDetail(metrics.openErrors, "Aguardando análise")} />
        <Kpi label="Jobs pendentes" value={kpiValue(metrics.pendingJobs)} detail={kpiDetail(metrics.pendingJobs, "Na fila de processamento")} />
        <Kpi label="Jobs falhos" value={kpiValue(metrics.failedJobs)} tone={kpiTone(metrics.failedJobs, "warning")} detail={kpiDetail(metrics.failedJobs, "Com falha registrada")} />
        <Kpi label="Webhooks falhos" value={kpiValue(metrics.failedWebhooks)} tone={kpiTone(metrics.failedWebhooks, "warning")} detail={kpiDetail(metrics.failedWebhooks, "Com falha registrada")} />
        <Kpi label="Eventos de segurança 24h" value={kpiValue(metrics.recentSecurityEvents)} tone={kpiTone(metrics.recentSecurityEvents, "warning")} detail={kpiDetail(metrics.recentSecurityEvents, "Registrados no período")} />
      </KpiStrip>

      {showServices ? (
        <TechnicalSection id="technical-services" title="Saúde dos serviços" hideTitle={section === "saude-servicos"}>
          {loading ? <LoadingBlock label="Verificando serviços…" rows={3} /> : services.length === 0 ? (
            <StateMessage compact kind={message ? "unavailable" : "empty"} title={message ? "Consulta de serviços indisponível." : "Nenhum estado de serviço disponível."} />
          ) : (
            <table className="data-table ui-table-stack technical-table">
              <thead>
                <tr><th scope="col">Serviço</th><th scope="col">Estado</th><th scope="col">Detalhe</th><th scope="col" className="ui-num">Latência</th><th scope="col">Verificado em</th></tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.name}>
                    <td data-label="Serviço"><strong>{service.name}</strong></td>
                    <td data-label="Estado"><StatusLabel tone={stateTones[service.state] ?? "neutral"}>{stateLabels[service.state] ?? service.state}</StatusLabel></td>
                    <td data-label="Detalhe" className="technical-wrap">{service.detail}</td>
                    <td data-label="Latência" className="ui-num">{service.latencyMs !== null && service.latencyMs !== undefined ? `${service.latencyMs} ms` : <span className="technical-muted">Latência não disponível</span>}</td>
                    <td data-label="Verificado em">{service.checkedAt ? <time dateTime={service.checkedAt}>{formatDateTime(service.checkedAt)}</time> : <span className="technical-muted">Não informado</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TechnicalSection>
      ) : null}

      {showIntegrations ? <BlingIntegration /> : null}
      {showIntegrations ? (
        <TechnicalSection
          id="technical-melhor-envio"
          title="Melhor Envio"
          status={melhorEnvio ? <StatusLabel tone={melhorEnvio.connected ? stateTones[melhorEnvio.health] ?? "neutral" : "neutral"}>{melhorEnvio.connected ? "OAuth conectado" : "OAuth não conectado"}</StatusLabel> : null}
        >
          {loading ? <LoadingBlock label="Carregando status do Melhor Envio…" rows={3} /> : !melhorEnvio ? (
            <StateMessage compact kind="unavailable" title="Status detalhado indisponível." />
          ) : <>
            <dl className="technical-facts">
              <Fact label="Ambiente" value={melhorEnvio.environment === "production" ? "Produção" : "Sandbox"} />
              <Fact label="OAuth do painel" value={melhorEnvio.connected ? "Conectado" : "Não conectado"} />
              <Fact label="Token" value={tokenState(melhorEnvio)} />
              <Fact label="Webhook" value={melhorEnvio.webhookConfigured ? "Configurado" : "Pendente"} />
              <Fact label="Origem" value={melhorEnvio.originComplete ? "Completa" : "Incompleta"} />
              <Fact label="Latência" value={`${melhorEnvio.latencyMs} ms`} numeric />
              <Fact label="Última comunicação" value={formatDateTime(melhorEnvio.lastCheckedAt)} numeric />
              <Fact label="Último erro" value={melhorEnvio.lastErrorDetail ?? melhorEnvio.lastError ?? "Nenhum"} code={Boolean(melhorEnvio.lastErrorDetail ?? melhorEnvio.lastError)} />
              <Fact label="Chave dos tokens" value={keyRotationState(melhorEnvio.keyRotation)} />
              {melhorEnvio.storeShipping ? <Fact label="Último resultado do frete da loja" value={stateLabels[melhorEnvio.storeShipping.state] ?? "Indisponível"} /> : null}
            </dl>
            <div className="technical-notes">
              {melhorEnvio.keyRotation ? <p className="technical-note">{withEnvCode(keyRotationNote(melhorEnvio.keyRotation))}</p> : null}
              {melhorEnvio.storeShipping
                ? <p className="technical-note">{melhorEnvio.storeShipping.detail}</p>
                : <p className="technical-note">Diagnóstico do frete da loja indisponível.</p>}
              {!melhorEnvio.originComplete && melhorEnvio.originMissingFields.length > 0
                ? <p className="technical-note">Configuração de origem pendente: {melhorEnvio.originMissingFields.join(", ")}.</p>
                : null}
            </div>
            {integrationMessage ? <p className="admin-feedback error technical-inline-feedback" role="alert">{integrationMessage}</p> : null}
            <div className="technical-actions">
              <div className="technical-actions-group">
                {!melhorEnvio.connected
                  ? <button className="primary-button" type="button" disabled={integrationBusy} onClick={() => void connectMelhorEnvio(false)}>Conectar</button>
                  : melhorEnvio.health !== "online"
                    // Reconectar mantém os tokens atuais até o callback confirmar a nova autorização.
                    ? <button className="primary-button" type="button" disabled={integrationBusy} onClick={() => void connectMelhorEnvio(true)}>Reconectar</button>
                    : null}
                <button className="secondary-button" type="button" disabled={integrationBusy} onClick={() => void load()}>Testar OAuth do painel</button>
              </div>
              {melhorEnvio.connected
                ? <button className="secondary-button technical-danger-action" type="button" disabled={integrationBusy} onClick={() => void disconnectMelhorEnvio()}>Desconectar</button>
                : null}
            </div>
            <p className="technical-safety-note">Tokens, secrets e assinaturas nunca são exibidos.</p>
          </>}
        </TechnicalSection>
      ) : null}

      {showStorage ? (
        <TechnicalSection id="technical-storage" title="Storage" hideTitle={section === "storage"} note="Somente totais agregados são exibidos; caminhos e arquivos privados não são expostos.">
          {loading ? <LoadingBlock label="Carregando storage…" rows={2} /> : storage.length === 0 ? (
            message || warning.includes("storage")
              ? <StateMessage compact kind="unavailable" title="Resumo de storage indisponível." />
              : <StateMessage compact title="Nenhum bucket criado." />
          ) : (
            <table className="data-table ui-table-stack technical-table">
              <thead><tr><th scope="col">Bucket</th><th scope="col" className="ui-num">Arquivos</th><th scope="col" className="ui-num">Tamanho</th></tr></thead>
              <tbody>
                {storage.map((bucket) => (
                  <tr key={bucket.bucket_id}>
                    <td data-label="Bucket"><code className="ui-code">{bucket.bucket_id}</code></td>
                    <td data-label="Arquivos" className="ui-num">{bucket.object_count.toLocaleString("pt-BR")}</td>
                    <td data-label="Tamanho" className="ui-num">{bytes.format(bucket.total_bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TechnicalSection>
      ) : null}

      {showDatabase ? (
        <TechnicalSection id="technical-database" title="Banco e integridade" note="Diagnóstico somente leitura e agregado. O painel não oferece execução de SQL arbitrário.">
          {loading ? <LoadingBlock label="Carregando diagnóstico do banco…" rows={2} /> : Object.keys(database).length === 0 ? (
            <StateMessage compact kind="unavailable" title="Diagnóstico agregado indisponível." />
          ) : (
            <dl className="technical-facts">
              <Fact label="Versão do PostgreSQL" value={textValue(database.server_version) || "Indisponível"} code={Boolean(textValue(database.server_version))} />
              <Fact label="Última migration" value={textValue(database.last_migration) || "Indisponível"} code={Boolean(textValue(database.last_migration))} />
              <Fact label="Conexões ativas" value={numberValue(database.active_connections).toLocaleString("pt-BR")} numeric />
              <Fact label="Tamanho do banco" value={bytes.format(numberValue(database.database_size_bytes))} numeric />
              <Fact label="Tabelas públicas" value={numberValue(database.public_tables).toLocaleString("pt-BR")} numeric />
              <Fact label="Índices públicos" value={numberValue(database.public_indexes).toLocaleString("pt-BR")} numeric />
            </dl>
          )}
        </TechnicalSection>
      ) : null}

      {showSessionNote ? (
        <TechnicalSection id="technical-sessions" title="Sessões e autenticação">
          <p className="technical-note">A sessão atual foi validada pelo Supabase Auth. Tokens, cookies e sessões de outros usuários não são expostos no navegador.</p>
        </TechnicalSection>
      ) : null}

      {showRuntime ? (
        <TechnicalSection id="technical-runtime" title="Runtime, deploy e manutenção">
          {loading ? <LoadingBlock label="Carregando runtime…" rows={3} /> : message ? (
            <StateMessage compact kind="unavailable" title="Configuração de runtime indisponível." />
          ) : <>
            <div className="technical-deploys">
              <DeploymentFacts label="Loja" value={deployments.store} />
              <DeploymentFacts label="Painel" value={deployments.panel} />
            </div>
            <dl className="technical-facts">
              <Fact label="Ambiente" value={textValue(runtime.environment) || "Não configurado"} />
              <Fact label="Versão" value={textValue(runtime.version) || "Metadados de versão não informados"} code={Boolean(textValue(runtime.version))} />
              <Fact label="Backups" value={textValue(runtime.backup) || "Não configurado"} />
            </dl>
            {textValue(runtime.databaseDiagnostics) ? <p className="technical-note">{textValue(runtime.databaseDiagnostics)}</p> : null}
          </>}
        </TechnicalSection>
      ) : null}
    </div>
  );
}

function formatMetric(value: number | string) {
  return typeof value === "number" ? value.toLocaleString("pt-BR") : value;
}

// Destaca nomes de variáveis de ambiente (ex.: MELHOR_ENVIO_TOKEN_...) em fonte mono, sem alterar o texto.
function withEnvCode(text: string): ReactNode {
  return text.split(/([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)/u).map((part, index) =>
    index % 2 === 1 ? <code className="ui-code" key={index}>{part}</code> : part
  );
}

// Na rota dedicada ao bloco, o cabeçalho da página já nomeia a seção: o título fica só para leitores de tela.
function TechnicalSection({ id, title, status, note, hideTitle, children }: { id: string; title: string; status?: ReactNode; note?: string; hideTitle?: boolean; children: ReactNode }) {
  return (
    <section className="technical-section" aria-labelledby={id}>
      {hideTitle && !status ? <h2 id={id} className="sr-only">{title}</h2> : <SectionHeader id={id} title={title} actions={status ?? undefined} />}
      <div className="technical-sheet">
        {children}
        {note ? <p className="technical-safety-note">{note}</p> : null}
      </div>
    </section>
  );
}

function Fact({ label, value, code, numeric }: { label: string; value: string; code?: boolean; numeric?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={code ? "ui-code" : numeric ? "ui-num" : undefined}>{value}</dd>
    </div>
  );
}

function DeploymentFacts({ label, value }: { label: string; value: unknown }) {
  const deployment = isRecord(value) ? value : {};
  const commit = textValue(deployment.commit);
  const build = textValue(deployment.build);
  return (
    <div className="technical-deploy">
      <h3>{label}</h3>
      <dl className="technical-facts technical-facts-stacked">
        <Fact label="Ambiente" value={textValue(deployment.environment) || "Não informado"} />
        <Fact label="Commit" value={commit || "Não informado"} code={Boolean(commit)} />
        <Fact label="Build" value={build || "Metadados de build não informados"} code={Boolean(build)} />
        <Fact label="Gerado em" value={textValue(deployment.builtAt) || "Não informado"} numeric />
      </dl>
    </div>
  );
}
