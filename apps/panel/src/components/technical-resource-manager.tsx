"use client";

import { ChevronLeft, ChevronRight, Download, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { technicalResources, type TechnicalColumn, type TechnicalResourceKey } from "@/lib/technical-resources";

type Item = Record<string, unknown>;
type Filters = { q: string; status: string; severity: string; source: string; route: string; from: string; to: string; user: string; request: string };

const initialFilters: Filters = { q: "", status: "", severity: "", source: "", route: "", from: "", to: "", user: "", request: "" };
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const statusLabels: Record<string, string> = {
  online: "Conectado", degraded: "Degradado", offline: "Com erro", not_configured: "Não configurado",
  awaiting_credentials: "Aguardando credenciais", maintenance: "Manutenção", pending: "Pendente", running: "Processando",
  completed: "Concluído", failed: "Falhou", cancelled: "Cancelado", open: "Aberto", investigating: "Investigando",
  resolved: "Resolvido", ignored: "Ignorado", error: "Erro", critical: "Crítico", fatal: "Fatal", warning: "Alerta",
  info: "Informação", true: "Sim", false: "Não", technical: "Técnico"
};

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

export function TechnicalResourceManager({ resource }: { resource: TechnicalResourceKey }) {
  const definition = technicalResources[resource];
  const [items, setItems] = useState<Item[]>([]);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [submitted, setSubmitted] = useState<Filters>(initialFilters);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const parameters = useMemo(() => {
    const params = new URLSearchParams({ page: String(page) });
    Object.entries(submitted).forEach(([key, value]) => { if (value) params.set(key, value); });
    return params;
  }, [page, submitted]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/technical/resources/${resource}?${parameters}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok || !isItem(payload)) throw new Error("load_failed");
      setItems(Array.isArray(payload.items) ? payload.items.filter(isItem) : []);
      setTotal(numberValue(payload.total));
    } catch {
      setMessage("Não foi possível carregar os registros técnicos.");
    } finally {
      setLoading(false);
    }
  }, [parameters, resource]);

  useEffect(() => { void load(); }, [load]);

  const runAction = async (body: Record<string, unknown>, confirmation: string) => {
    if (pending || !window.confirm(confirmation)) return;
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

  const reasonedAction = (body: Record<string, unknown>, promptText: string, confirmation: string) => {
    const reason = window.prompt(promptText)?.trim();
    if (!reason) return;
    void runAction({ ...body, reason }, confirmation);
  };

  const resolveEvent = (item: Item, status: "investigating" | "resolved" | "ignored") => {
    const note = window.prompt("Registre a análise ou resolução deste evento:")?.trim();
    if (!note || typeof item.id !== "string") return;
    void runAction({ action: "resolve_event", id: item.id, status, note }, `Confirmar alteração do evento para ${statusLabels[status]}?`);
  };

  const updateFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const pages = Math.max(1, Math.ceil(total / 25));
  const hasSeverity = ["logs", "erros", "seguranca", "performance"].includes(resource);
  const hasSource = ["logs", "erros", "performance"].includes(resource);
  const hasRoute = ["logs", "erros", "performance"].includes(resource);
  const hasUser = ["logs", "erros", "seguranca", "acessos-tecnicos", "auditoria-tecnica", "performance"].includes(resource);
  const hasRequest = ["logs", "erros", "seguranca", "acessos-tecnicos", "auditoria-tecnica"].includes(resource);

  return (
    <section className="panel-card admin-resource technical-resource">
      <header className="admin-resource-header">
        <div><h2>{definition.label}</h2><p>{definition.description}</p></div>
        {definition.exportAllowed ? <a className="secondary-button" href={`/api/technical/resources/${resource}?${parameters}&format=csv`}><Download aria-hidden="true" /> Exportar sanitizado</a> : null}
      </header>

      <form className="technical-filters" onSubmit={(event: FormEvent) => { event.preventDefault(); setPage(1); setSubmitted(filters); }}>
        <label className="technical-search"><Search aria-hidden="true" /><span className="sr-only">Buscar</span><input value={filters.q} onChange={(event) => updateFilter("q", event.target.value)} placeholder="Buscar mensagem, serviço ou evento" /></label>
        {definition.statusColumn ? <input aria-label="Status" value={filters.status} onChange={(event) => updateFilter("status", event.target.value)} placeholder="Status exato" /> : null}
        {hasSeverity ? <select aria-label="Nível" value={filters.severity} onChange={(event) => updateFilter("severity", event.target.value)}><option value="">Todos os níveis</option><option value="info">Informação</option><option value="warning">Alerta</option><option value="error">Erro</option><option value="critical">Crítico</option><option value="fatal">Fatal</option></select> : null}
        {hasSource ? <input aria-label="Serviço" value={filters.source} onChange={(event) => updateFilter("source", event.target.value)} placeholder="Serviço exato" /> : null}
        {hasRoute ? <input aria-label="Rota" value={filters.route} onChange={(event) => updateFilter("route", event.target.value)} placeholder="Rota contém" /> : null}
        {definition.dateColumn ? <><input aria-label="Data inicial" type="date" value={filters.from} onChange={(event) => updateFilter("from", event.target.value)} /><input aria-label="Data final" type="date" value={filters.to} onChange={(event) => updateFilter("to", event.target.value)} /></> : null}
        {hasUser ? <input aria-label="Usuário" value={filters.user} onChange={(event) => updateFilter("user", event.target.value)} placeholder="ID do usuário" /> : null}
        {hasRequest ? <input aria-label="Correlação" value={filters.request} onChange={(event) => updateFilter("request", event.target.value)} placeholder="ID de correlação" /> : null}
        <button className="primary-button" type="submit" disabled={loading}>Aplicar filtros</button>
        <button className="icon-button" type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar"><RefreshCw className={loading ? "spin" : ""} /></button>
      </form>

      {message ? <p className="admin-feedback" role="status">{message}</p> : null}
      {loading ? <div className="admin-loading"><LoaderCircle className="spin" /> Carregando</div> : items.length === 0 ? <div className="admin-empty-state"><h3>Nenhum registro encontrado</h3><p>Não há dados reais para os filtros informados.</p></div> : (
        <div className="admin-table-wrap">
          <table className="data-table admin-data-table">
            <thead><tr>{definition.columns.map((column) => <th key={column.key}>{column.label}</th>)}<th>Detalhes</th>{supportsActions(resource) ? <th>Ações</th> : null}</tr></thead>
            <tbody>{items.map((item, index) => (
              <tr key={typeof item.id === "string" ? item.id : typeof item.key === "string" ? item.key : `${resource}-${index}`}>
                {definition.columns.map((column) => <td key={column.key} data-label={column.label}>{display(item[column.key], column)}</td>)}
                <td data-label="Detalhes"><TechnicalDetails item={item} /></td>
                {supportsActions(resource) ? <td data-label="Ações" className="technical-row-actions"><TechnicalActions resource={resource} item={item} disabled={pending} reasonedAction={reasonedAction} resolveEvent={resolveEvent} /></td> : null}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <footer className="admin-pagination"><span>{total.toLocaleString("pt-BR")} registros</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} aria-label="Página anterior"><ChevronLeft /></button><span>Página {page} de {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)} aria-label="Próxima página"><ChevronRight /></button></div></footer>
    </section>
  );
}

function supportsActions(resource: TechnicalResourceKey): boolean {
  return ["logs", "erros", "webhooks", "filas", "jobs", "falhas", "feature-flags"].includes(resource);
}

function TechnicalDetails({ item }: { item: Item }) {
  const details = item.context_sanitized ?? item.payload_sanitized ?? item.metadata_sanitized ?? item.new_data_sanitized ?? item.error_summary;
  if (details === null || details === undefined || details === "") return <span>—</span>;
  return <details className="technical-details"><summary>Ver detalhes</summary><pre>{display(details, { key: "details", label: "Detalhes", format: typeof details === "object" ? "json" : undefined })}</pre></details>;
}

function TechnicalActions({ resource, item, disabled, reasonedAction, resolveEvent }: { resource: TechnicalResourceKey; item: Item; disabled: boolean; reasonedAction: (body: Record<string, unknown>, promptText: string, confirmation: string) => void; resolveEvent: (item: Item, status: "investigating" | "resolved" | "ignored") => void }) {
  const id = typeof item.id === "string" ? item.id : "";
  const status = scalar(item.status || item.processing_status || item.resolution_status);
  if ((resource === "logs" || resource === "erros") && id) {
    return <div className="technical-action-group">{status === "open" ? <button className="secondary-button" type="button" disabled={disabled} onClick={() => resolveEvent(item, "investigating")}>Investigar</button> : null}{!new Set(["resolved", "ignored"]).has(status) ? <button className="primary-button" type="button" disabled={disabled} onClick={() => resolveEvent(item, "resolved")}>Resolver</button> : null}{status !== "ignored" ? <button className="secondary-button" type="button" disabled={disabled} onClick={() => resolveEvent(item, "ignored")}>Ignorar</button> : null}</div>;
  }
  if (["filas", "jobs", "falhas"].includes(resource) && id) {
    if (["failed", "cancelled"].includes(status)) return <button className="primary-button" type="button" disabled={disabled} onClick={() => reasonedAction({ action: "reprocess_job", id }, "Justifique o reprocessamento:", "Recolocar este job na fila?")}>Reprocessar</button>;
    if (["pending", "running"].includes(status)) return <button className="secondary-button danger-button" type="button" disabled={disabled} onClick={() => reasonedAction({ action: "cancel_job", id }, "Justifique o cancelamento:", "Cancelar este job?")}>Cancelar</button>;
  }
  if (resource === "webhooks" && id && ["failed", "error"].includes(status)) return <button className="primary-button" type="button" disabled={disabled} onClick={() => reasonedAction({ action: "reprocess_webhook", id }, "Justifique o reprocessamento:", "Reprocessar este evento de pagamento?")}>Reprocessar</button>;
  if (resource === "feature-flags" && typeof item.key === "string") {
    const enabled = item.enabled === true;
    const key = item.key;
    return <button className={enabled ? "secondary-button danger-button" : "primary-button"} type="button" disabled={disabled} onClick={() => reasonedAction({ action: "set_feature_flag", key, enabled: !enabled }, "Justifique a alteração da flag:", `${enabled ? "Desativar" : "Ativar"} a flag ${key}?`)}>{enabled ? "Desativar" : "Ativar"}</button>;
  }
  return <span>—</span>;
}
