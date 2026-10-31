"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Download, RefreshCw, Search, X } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { technicalResources, type TechnicalColumn, type TechnicalResourceKey } from "@/lib/technical-resources";
import { type PanelConfirmOptions, usePanelConfirm, usePanelPrompt } from "./panel-prompt";
import { LoadingBlock, PageHeader, StateMessage, StatusLabel, type UiTone } from "./panel-ui";

type Item = Record<string, unknown>;
type TechnicalCapabilities = { export: boolean; manageLogs: boolean; manageJobs: boolean; manageWebhooks: boolean; manageFeatures: boolean };
const noCapabilities: TechnicalCapabilities = { export: false, manageLogs: false, manageJobs: false, manageWebhooks: false, manageFeatures: false };
type Filters = { q: string; status: string; severity: string; source: string; route: string; from: string; to: string; user: string; request: string };

const initialFilters: Filters = { q: "", status: "", severity: "", source: "", route: "", from: "", to: "", user: "", request: "" };
const pageSize = 25;
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" });
const statusLabels: Record<string, string> = {
  online: "Conectado", degraded: "Degradado", offline: "Com erro", not_configured: "Não configurado",
  awaiting_credentials: "Aguardando credenciais", maintenance: "Manutenção", pending: "Pendente", running: "Processando",
  completed: "Concluído", failed: "Falhou", cancelled: "Cancelado", open: "Aberto", investigating: "Investigando",
  resolved: "Resolvido", ignored: "Ignorado", error: "Erro", critical: "Crítico", fatal: "Fatal", warning: "Alerta",
  info: "Informação", true: "Sim", false: "Não", technical: "Técnico"
};
// O mesmo significado usa o mesmo tom em todas as tabelas técnicas; vermelho só para falha ou gravidade alta.
const statusTones: Record<string, UiTone> = {
  online: "success", completed: "success", resolved: "success",
  degraded: "warning", awaiting_credentials: "warning", maintenance: "warning", open: "warning", warning: "warning",
  running: "info", investigating: "info",
  offline: "danger", failed: "danger", error: "danger", critical: "danger", fatal: "danger"
};
// Colunas com identificadores, rotas e mensagens técnicas, exibidas em fonte mono.
const codeColumns = new Set(["user_id", "request_id", "actor_id", "ip_hash", "route", "key", "assigned_to", "updated_by",
  "message", "error_summary", "event_type", "job_type", "queue"]);
const numericColumns = new Set(["attempts", "frequency_on_page"]);

function isItem(value: unknown): value is Item {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function display(value: unknown, column: TechnicalColumn): string {
  if (value === null || value === undefined || value === "") return "—";
  if (column.format === "status") {
    const key = scalar(value);
    return (statusLabels[key] ?? key) || "—";
  }
  if (column.format === "datetime" && typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return dateTime.format(parsed);
  }
  if (column.format === "duration") return `${numberValue(value).toLocaleString("pt-BR")} ms`;
  if (column.format === "bytes") return `${numberValue(value).toLocaleString("pt-BR")} bytes`;
  if (column.format === "json" || typeof value === "object") {
    try { return JSON.stringify(value); } catch { return "—"; }
  }
  return scalar(value) || "—";
}

function prettyJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return "—"; }
}

function isNumericColumn(column: TechnicalColumn): boolean {
  return column.format === "duration" || column.format === "bytes" || numericColumns.has(column.key);
}

function statusTone(value: unknown, column: TechnicalColumn): UiTone {
  const key = scalar(value);
  // Assinatura inválida em webhook é falha de segurança; "Não" em outras colunas é neutro.
  if (column.key === "signature_valid") return key === "true" ? "success" : key === "false" ? "danger" : "neutral";
  if (column.key === "enabled") return key === "true" ? "success" : "neutral";
  return statusTones[key] ?? "neutral";
}

function Cell({ value, column }: { value: unknown; column: TechnicalColumn }): ReactNode {
  const text = display(value, column);
  if (text === "—") return <span className="technical-muted">—</span>;
  if (column.format === "status") return <StatusLabel tone={statusTone(value, column)}>{text}</StatusLabel>;
  if (column.format === "datetime" && typeof value === "string") return <time dateTime={value}>{text}</time>;
  if (column.format === "json" || typeof value === "object") {
    return <details className="technical-details"><summary>Ver JSON</summary><pre className="ui-code">{prettyJson(value)}</pre></details>;
  }
  if (isNumericColumn(column)) return text;
  return <span className={codeColumns.has(column.key) ? "technical-cell-text ui-code" : "technical-cell-text"} title={text}>{text}</span>;
}

export function TechnicalResourceManager({ resource, initialQuery = "" }: { resource: TechnicalResourceKey; initialQuery?: string }) {
  const requestPrompt = usePanelPrompt();
  const requestConfirm = usePanelConfirm();
  const definition = technicalResources[resource];
  const [items, setItems] = useState<Item[]>([]);
  const [filters, setFilters] = useState<Filters>({ ...initialFilters, q: initialQuery });
  const [submitted, setSubmitted] = useState<Filters>({ ...initialFilters, q: initialQuery });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [capabilities, setCapabilities] = useState<TechnicalCapabilities>(noCapabilities);

  const parameters = useMemo(() => {
    const params = new URLSearchParams({ page: String(page) });
    Object.entries(submitted).forEach(([key, value]) => { if (value) params.set(key, value); });
    return params;
  }, [page, submitted]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/technical/resources/${resource}?${parameters}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok || !isItem(payload)) throw new Error("load_failed");
      setItems(Array.isArray(payload.items) ? payload.items.filter(isItem) : []);
      setTotal(numberValue(payload.total));
      setCapabilities(isItem(payload.capabilities) ? {
        export: payload.capabilities.export === true,
        manageLogs: payload.capabilities.manageLogs === true,
        manageJobs: payload.capabilities.manageJobs === true,
        manageWebhooks: payload.capabilities.manageWebhooks === true,
        manageFeatures: payload.capabilities.manageFeatures === true
      } : noCapabilities);
    } catch {
      setItems([]);
      setTotal(0);
      setCapabilities(noCapabilities);
      setLoadError("Não foi possível carregar os registros técnicos.");
    } finally {
      setLoading(false);
    }
  }, [parameters, resource]);

  useEffect(() => { void load(); }, [load]);

  const runAction = async (body: Record<string, unknown>, confirmation?: PanelConfirmOptions) => {
    if (pending) return;
    if (confirmation && !(await requestConfirm(confirmation))) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/technical/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isItem(payload)) throw new Error("action_failed");
      setMessage(typeof payload.message === "string" ? payload.message : "Ação concluída.");
      await load();
    } catch {
      setMessage("A ação técnica não foi concluída. Confira o estado atual e sua permissão.");
    } finally {
      setPending(false);
    }
  };

  const reasonedAction = async (body: Record<string, unknown>, promptText: string, confirmation?: PanelConfirmOptions) => {
    const reason = (await requestPrompt({
      title: "Confirmar ação técnica",
      label: promptText,
      minLength: 3
    }))?.trim();
    if (!reason) return;
    await runAction({ ...body, reason }, confirmation);
  };

  const resolveEvent = async (item: Item, status: "investigating" | "resolved" | "ignored") => {
    const note = (await requestPrompt({
      title: "Atualizar evento técnico",
      label: "Análise ou resolução",
      minLength: 3
    }))?.trim();
    if (!note || typeof item.id !== "string") return;
    await runAction({ action: "resolve_event", id: item.id, status, note });
  };

  const updateFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const clearFilters = () => { setFilters(initialFilters); setSubmitted(initialFilters); setPage(1); };
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const hasSeverity = ["logs", "erros", "seguranca", "performance"].includes(resource);
  const hasSource = ["logs", "erros", "performance"].includes(resource);
  const hasRoute = ["logs", "erros", "performance"].includes(resource);
  const hasUser = ["logs", "erros", "seguranca", "acessos-tecnicos", "auditoria-tecnica", "performance"].includes(resource);
  const hasRequest = ["logs", "erros", "seguranca", "acessos-tecnicos", "auditoria-tecnica"].includes(resource);
  const canAct = actionAllowed(resource, capabilities);
  const hasFilters = Object.values(filters).some(Boolean) || Object.values(submitted).some(Boolean);
  const hasSubmittedFilters = Object.values(submitted).some(Boolean);
  const hasMoreFilters = hasSource || hasRoute || hasUser || hasRequest;
  const moreFiltersActive = [hasSource && filters.source, hasRoute && filters.route, hasUser && filters.user, hasRequest && filters.request].filter(Boolean).length;
  const firstItem = total === 0 || items.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = firstItem === 0 ? 0 : firstItem + items.length - 1;
  const rangeText = firstItem === 0
    ? `${total.toLocaleString("pt-BR")} registros`
    : `${firstItem.toLocaleString("pt-BR")}–${lastItem.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")}`;

  return (
    <section className="technical-resource" aria-labelledby="technical-resource-title">
      <PageHeader
        titleId="technical-resource-title"
        title={definition.label}
        description={definition.description}
        actions={capabilities.export ? <a className="secondary-button" href={`/api/technical/resources/${resource}?${parameters}&format=csv`}><Download aria-hidden="true" /> Exportar sanitizado</a> : undefined}
      />

      <form className="technical-filters" aria-label="Filtros" onSubmit={(event: FormEvent) => { event.preventDefault(); setPage(1); setSubmitted(filters); }}>
        <div className="technical-filter-row">
          <label className="technical-field technical-search">
            <span>Buscar</span>
            <span className="technical-search-input">
              <Search aria-hidden="true" />
              <input value={filters.q} onChange={(event) => updateFilter("q", event.target.value)} placeholder="Mensagem, serviço ou evento" />
            </span>
          </label>
          {definition.statusColumn ? <label className="technical-field"><span>Status</span><input aria-label="Status" value={filters.status} onChange={(event) => updateFilter("status", event.target.value)} placeholder="Status exato" /></label> : null}
          {hasSeverity ? <label className="technical-field"><span>Nível</span><select aria-label="Nível" value={filters.severity} onChange={(event) => updateFilter("severity", event.target.value)}><option value="">Todos os níveis</option><option value="info">Informação</option><option value="warning">Alerta</option><option value="error">Erro</option><option value="critical">Crítico</option><option value="fatal">Fatal</option></select></label> : null}
          {definition.dateColumn ? <>
            <label className="technical-field technical-field-date"><span>De</span><input aria-label="Data inicial" type="date" value={filters.from} onChange={(event) => updateFilter("from", event.target.value)} /></label>
            <label className="technical-field technical-field-date"><span>Até</span><input aria-label="Data final" type="date" value={filters.to} onChange={(event) => updateFilter("to", event.target.value)} /></label>
          </> : null}
          <div className="technical-filter-actions">
            <button className="primary-button" type="submit" disabled={loading}>Aplicar filtros</button>
            {hasFilters ? <button className="ghost-button filter-clear-button" type="button" onClick={clearFilters}><X aria-hidden="true" /> Limpar</button> : null}
            <button className="icon-button" type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar" title="Atualizar"><RefreshCw className={loading ? "spin" : ""} aria-hidden="true" /></button>
          </div>
        </div>
        {hasMoreFilters ? (
          <details className="technical-more-filters" open={moreFiltersActive > 0 || undefined}>
            <summary><ChevronDown aria-hidden="true" />Mais filtros{moreFiltersActive > 0 ? ` (${moreFiltersActive})` : ""}</summary>
            <div className="technical-filter-row">
              {hasSource ? <label className="technical-field"><span>Serviço</span><input aria-label="Serviço" value={filters.source} onChange={(event) => updateFilter("source", event.target.value)} placeholder="Serviço exato" /></label> : null}
              {hasRoute ? <label className="technical-field"><span>Rota</span><input aria-label="Rota" value={filters.route} onChange={(event) => updateFilter("route", event.target.value)} placeholder="Rota contém" /></label> : null}
              {hasUser ? <label className="technical-field"><span>Usuário</span><input aria-label="Usuário" value={filters.user} onChange={(event) => updateFilter("user", event.target.value)} placeholder="ID do usuário" /></label> : null}
              {hasRequest ? <label className="technical-field"><span>Correlação</span><input aria-label="Correlação" value={filters.request} onChange={(event) => updateFilter("request", event.target.value)} placeholder="ID de correlação" /></label> : null}
            </div>
          </details>
        ) : null}
        <p className="technical-count" aria-live="polite">{loading ? "Carregando registros…" : loadError ? "Contagem indisponível" : rangeText}</p>
      </form>

      {message ? <p className="admin-feedback info" role="status">{message}</p> : null}
      <div className="admin-table-wrap technical-table-wrap">
        {loading ? <LoadingBlock label="Carregando registros técnicos…" rows={6} /> : loadError ? (
          <StateMessage
            kind="error"
            title="Consulta técnica indisponível"
            description={loadError}
            action={<button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" /> Tentar novamente</button>}
          />
        ) : items.length === 0 ? (
          <StateMessage
            title="Nenhum registro encontrado"
            description={hasSubmittedFilters ? "Não há dados reais para os filtros informados." : "Ainda não há dados reais registrados nesta área."}
            action={hasSubmittedFilters ? <button className="secondary-button" type="button" onClick={clearFilters}><X aria-hidden="true" /> Limpar filtros</button> : undefined}
          />
        ) : (
          <table className="data-table ui-table-stack technical-table">
            <thead><tr>{definition.columns.map((column) => <th key={column.key} scope="col" className={isNumericColumn(column) ? "ui-num" : undefined}>{column.label}</th>)}<th scope="col">Detalhes</th>{canAct ? <th scope="col" className="technical-actions-head">Ações</th> : null}</tr></thead>
            <tbody>{items.map((item, index) => (
              <tr key={typeof item.id === "string" ? item.id : typeof item.key === "string" ? item.key : `${resource}-${index}`}>
                {definition.columns.map((column) => <td key={column.key} data-label={column.label} className={isNumericColumn(column) ? "ui-num" : undefined}><Cell value={item[column.key]} column={column} /></td>)}
                <td data-label="Detalhes"><TechnicalDetails item={item} /></td>
                {canAct ? <td data-label="Ações" className="technical-row-actions"><TechnicalActions resource={resource} item={item} disabled={pending} reasonedAction={(...arguments_) => { void reasonedAction(...arguments_); }} resolveEvent={(...arguments_) => { void resolveEvent(...arguments_); }} /></td> : null}
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <footer className="admin-pagination technical-pagination"><span>{rangeText}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} aria-label="Página anterior" title="Página anterior"><ChevronLeft aria-hidden="true" /></button><span>Página {page} de {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)} aria-label="Próxima página" title="Próxima página"><ChevronRight aria-hidden="true" /></button></div></footer>
    </section>
  );
}

function actionAllowed(resource: TechnicalResourceKey, capabilities: TechnicalCapabilities): boolean {
  if (["logs", "erros"].includes(resource)) return capabilities.manageLogs;
  if (["filas", "jobs", "falhas"].includes(resource)) return capabilities.manageJobs;
  if (resource === "webhooks") return capabilities.manageWebhooks;
  if (resource === "feature-flags") return capabilities.manageFeatures;
  return false;
}

function TechnicalDetails({ item }: { item: Item }) {
  const details = item.context_sanitized ?? item.payload_sanitized ?? item.metadata_sanitized ?? item.new_data_sanitized ?? item.error_summary;
  if (details === null || details === undefined || details === "") return <span className="technical-muted">—</span>;
  return <details className="technical-details"><summary>Ver detalhes</summary><pre className="ui-code">{typeof details === "object" ? prettyJson(details) : display(details, { key: "details", label: "Detalhes" })}</pre></details>;
}

function TechnicalActions({ resource, item, disabled, reasonedAction, resolveEvent }: { resource: TechnicalResourceKey; item: Item; disabled: boolean; reasonedAction: (body: Record<string, unknown>, promptText: string, confirmation?: PanelConfirmOptions) => void; resolveEvent: (item: Item, status: "investigating" | "resolved" | "ignored") => void }) {
  const id = typeof item.id === "string" ? item.id : "";
  const status = scalar(item.status || item.processing_status || item.resolution_status);
  if ((resource === "logs" || resource === "erros") && id) {
    return <div className="technical-action-group">{status === "open" ? <button className="secondary-button" type="button" disabled={disabled} onClick={() => resolveEvent(item, "investigating")}>Investigar</button> : null}{!new Set(["resolved", "ignored"]).has(status) ? <button className="secondary-button" type="button" disabled={disabled} onClick={() => resolveEvent(item, "resolved")}>Resolver</button> : null}{status !== "ignored" ? <button className="ghost-button" type="button" disabled={disabled} onClick={() => resolveEvent(item, "ignored")}>Ignorar</button> : null}</div>;
  }
  if (["filas", "jobs", "falhas"].includes(resource) && id) {
    if (["failed", "cancelled"].includes(status)) return <button className="secondary-button" type="button" disabled={disabled} onClick={() => reasonedAction({ action: "reprocess_job", id }, "Justifique o reprocessamento:")}>Reprocessar</button>;
    if (["pending", "running"].includes(status)) return <button className="secondary-button technical-danger-action" type="button" disabled={disabled} onClick={() => reasonedAction({ action: "cancel_job", id }, "Justifique o cancelamento:", { title: "Cancelar este job?", description: "O job será cancelado e deixará de ser processado.", confirmLabel: "Cancelar job", cancelLabel: "Voltar", tone: "danger" })}>Cancelar</button>;
  }
  if (resource === "webhooks" && id && ["failed", "error"].includes(status)) return <button className="secondary-button" type="button" disabled={disabled} onClick={() => reasonedAction({ action: "reprocess_webhook", id }, "Justifique o reprocessamento:")}>Reprocessar</button>;
  if (resource === "feature-flags" && typeof item.key === "string") {
    const enabled = item.enabled === true;
    const key = item.key;
    return <button className={enabled ? "secondary-button technical-danger-action" : "secondary-button"} type="button" disabled={disabled} onClick={() => reasonedAction({ action: "set_feature_flag", key, enabled: !enabled }, "Justifique a alteração da flag:", enabled ? { title: `Desativar a flag ${key}?`, description: "A flag deixará de estar ativa para os perfis configurados.", confirmLabel: "Desativar", cancelLabel: "Voltar", tone: "danger" } : undefined)}>{enabled ? "Desativar" : "Ativar"}</button>;
  }
  return <span className="technical-muted">—</span>;
}
