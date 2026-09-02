"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Download,
  FileClock,
  FilterX,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRoundCog
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  actionLabels,
  activityDiff,
  actorLabel,
  displayAuditValue,
  isActivityLogResponse,
  moduleLabel,
  originLabel,
  type ActivityLog,
  type ActivityLogResponse,
} from "@/lib/activity-logs";
import { exportActivityWorkbook } from "@/lib/activity-export";
import { PanelDrawer } from "./panel-drawer";

type Filters = {
  preset: "today" | "7days" | "30days" | "custom";
  from: string;
  to: string;
  actor: string;
  actionType: string;
  module: string;
  origin: string;
  q: string;
};

const emptyResponse: ActivityLogResponse = {
  items: [], total: 0, page: 1, pageSize: 20,
  summary: { today: 0, last7Days: 0, deletions: 0, financial: 0, administrative: 0 },
  filters: { actors: [], actions: [], modules: [], origins: ["person", "system", "integration"] },
  capabilities: { export: false }
};

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo"
});

function saoPauloToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function subtractDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function presetDates(preset: Filters["preset"]) {
  const to = saoPauloToday();
  return preset === "today" ? { from: to, to } : { from: subtractDays(to, preset === "30days" ? 29 : 6), to };
}

function initialFilters(): Filters {
  return { preset: "7days", ...presetDates("7days"), actor: "", actionType: "", module: "", origin: "", q: "" };
}

function parameters(filters: Filters, search: string, page: number) {
  const params = new URLSearchParams({ page: String(page) });
  for (const [key, value] of Object.entries({ from: filters.from, to: filters.to, actor: filters.actor, action: filters.actionType, module: filters.module, origin: filters.origin, q: search })) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function ActivityLogs() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(emptyResponse);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [selected, setSelected] = useState<ActivityLog | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => { setPage(1); setDebouncedSearch(filters.q.trim()); }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.q]);

  const query = useMemo(() => parameters(filters, debouncedSearch, page), [filters, debouncedSearch, page]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/manager/activity-logs?${query}`, { cache: "no-store", signal });
      const payload: unknown = await response.json();
      if (!response.ok || !isActivityLogResponse(payload)) {
        const message = recordValue(payload)?.message;
        throw new Error(typeof message === "string" ? message : "Não foi possível carregar os registros.");
      }
      setData(payload);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os registros.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const update = <Key extends keyof Filters>(key: Key, value: Filters[Key]) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const usePreset = (preset: Filters["preset"]) => {
    if (preset === "custom") return update("preset", preset);
    setPage(1);
    setFilters((current) => ({ ...current, preset, ...presetDates(preset) }));
  };

  const clearFilters = () => {
    setPage(1);
    setFilters(initialFilters());
  };

  const exportLogs = async () => {
    setExporting(true);
    setFeedback("");
    try {
      const response = await fetch("/api/manager/activity-logs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "export", ...filters, q: debouncedSearch })
      });
      const payload: unknown = await response.json();
      const record = recordValue(payload);
      if (!response.ok || !record || !Array.isArray(record.items)) {
        throw new Error(typeof record?.message === "string" ? record.message : "Não foi possível exportar os registros.");
      }
      await exportActivityWorkbook(record.items as ActivityLog[], `${filters.from} a ${filters.to}`);
      setFeedback(record.truncated === true ? "Planilha exportada com o limite de 5.000 registros." : "Planilha exportada e ação registrada na auditoria.");
    } catch (exportError) {
      setFeedback(exportError instanceof Error ? exportError.message : "Não foi possível exportar os registros.");
    } finally {
      setExporting(false);
    }
  };

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const hasExtraFilters = Boolean(filters.actor || filters.actionType || filters.module || filters.origin || filters.q || filters.preset !== "7days");
  const metrics = [
    { label: "Hoje", value: data.summary.today, icon: CalendarDays },
    { label: "Últimos 7 dias", value: data.summary.last7Days, icon: FileClock },
    { label: "Exclusões", value: data.summary.deletions, icon: Trash2 },
    { label: "Financeiro", value: data.summary.financial, icon: CircleDollarSign },
    { label: "Administrativas", value: data.summary.administrative, icon: UserRoundCog }
  ];

  return (
    <section className="activity-logs manager-resource">
      <header className="activity-header">
        <div><span className="activity-eyebrow"><ShieldCheck aria-hidden="true" /> Governança e segurança</span><h1>Logs de Atividades</h1><p>Acompanhe alterações administrativas e operacionais com origem, responsável e diferenças registradas.</p></div>
        <div className="activity-header-actions">
          {data.capabilities.export ? <button className="secondary-button" type="button" onClick={() => void exportLogs()} disabled={exporting || loading}><Download aria-hidden="true" /> {exporting ? "Preparando..." : "Exportar XLSX"}</button> : null}
          <button className="icon-button" type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar logs"><RefreshCw className={loading ? "spin" : ""} /></button>
        </div>
      </header>

      <div className="activity-summary" aria-label="Resumo da auditoria">
        {metrics.map(({ label, value, icon: Icon }) => <article key={label}><Icon aria-hidden="true" /><span>{label}</span><strong>{value.toLocaleString("pt-BR")}</strong></article>)}
      </div>

      <div className="activity-filters panel-card">
        <div className="activity-filter-top">
          <form className="admin-search" onSubmit={(event) => { event.preventDefault(); setDebouncedSearch(filters.q.trim()); setPage(1); }}>
            <Search aria-hidden="true" /><label className="sr-only" htmlFor="activity-search">Buscar nos logs</label>
            <input id="activity-search" value={filters.q} onChange={(event) => update("q", event.target.value)} placeholder="Buscar pessoa, ação, descrição ou ID" maxLength={100} />
            <button className="secondary-button" type="submit">Buscar</button>
          </form>
          <label>Período<select value={filters.preset} onChange={(event) => usePreset(event.target.value as Filters["preset"])}><option value="today">Hoje</option><option value="7days">Últimos 7 dias</option><option value="30days">Últimos 30 dias</option><option value="custom">Personalizado</option></select></label>
          <label>De<input type="date" value={filters.from} max={filters.to} onChange={(event) => { update("from", event.target.value); update("preset", "custom"); }} /></label>
          <label>Até<input type="date" value={filters.to} min={filters.from} onChange={(event) => { update("to", event.target.value); update("preset", "custom"); }} /></label>
        </div>
        <details className="activity-advanced" open={hasExtraFilters}>
          <summary>Filtros avançados <small>responsável, ação, módulo e origem</small></summary>
          <div>
            <label>Responsável<select value={filters.actor} onChange={(event) => update("actor", event.target.value)}><option value="">Todos</option>{data.filters.actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
            <label>Ação<select value={filters.actionType} onChange={(event) => update("actionType", event.target.value)}><option value="">Todas</option>{data.filters.actions.map((action) => <option key={action} value={action}>{actionLabels[action]}</option>)}</select></label>
            <label>Módulo<select value={filters.module} onChange={(event) => update("module", event.target.value)}><option value="">Todos</option>{data.filters.modules.map((module) => <option key={module} value={module}>{moduleLabel(module)}</option>)}</select></label>
            <label>Origem<select value={filters.origin} onChange={(event) => update("origin", event.target.value)}><option value="">Todas</option>{data.filters.origins.map((origin) => <option key={origin} value={origin}>{originLabel(origin)}</option>)}</select></label>
            <button className="secondary-button" type="button" onClick={clearFilters}><FilterX aria-hidden="true" /> Limpar filtros</button>
          </div>
        </details>
      </div>

      {feedback ? <p className="admin-feedback" role="status">{feedback}</p> : null}
      {loading ? <ActivityLoading /> : error ? (
        <div className="admin-empty-state panel-card" role="alert"><h2>Consulta indisponível</h2><p>{error}</p><button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" /> Tentar novamente</button></div>
      ) : data.items.length === 0 ? (
        <div className="admin-empty-state panel-card"><FileClock aria-hidden="true" /><h2>Nenhuma atividade encontrada</h2><p>Ajuste os filtros ou o período para consultar outros registros reais.</p>{hasExtraFilters ? <button className="secondary-button" type="button" onClick={clearFilters}><FilterX aria-hidden="true" /> Limpar filtros</button> : null}</div>
      ) : (
        <div className="activity-list" aria-label="Atividades registradas">
          {data.items.map((item) => <ActivityRow key={item.id} item={item} onOpen={() => setSelected(item)} />)}
        </div>
      )}

      {!loading && !error && data.total > 0 ? <footer className="admin-pagination activity-pagination"><span>{data.total.toLocaleString("pt-BR")} registros</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} aria-label="Página anterior"><ChevronLeft /></button><span>Página {page} de {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)} aria-label="Próxima página"><ChevronRight /></button></div></footer> : null}

      <ActivityDetails item={selected} onClose={() => setSelected(null)} />
    </section>
  );
}

function ActivityRow({ item, onOpen }: { item: ActivityLog; onOpen: () => void }) {
  return <button className="activity-row" type="button" onClick={onOpen} aria-label={`Ver detalhes: ${item.description}`}>
    <span className={`activity-origin activity-origin-${item.origin_type}`} aria-hidden="true">{item.origin_type === "person" ? actorLabel(item).slice(0, 2).toUpperCase() : item.origin_type === "integration" ? "IN" : "SZ"}</span>
    <span className="activity-row-main"><span><strong>{actorLabel(item)}</strong><span className={`activity-badge activity-action-${item.action_type.toLowerCase()}`}>{actionLabels[item.action_type]}</span><span className="activity-badge">{moduleLabel(item.module)}</span></span><span>{item.description}</span><small>{item.entity_label || item.entity_type}{item.entity_id ? ` · ${item.entity_id.slice(0, 8)}` : ""}</small></span>
    <time dateTime={item.created_at}>{dateTime.format(new Date(item.created_at))}</time>
  </button>;
}

function ActivityDetails({ item, onClose }: { item: ActivityLog | null; onClose: () => void }) {
  const differences = item ? activityDiff(item) : [];
  return <PanelDrawer open={Boolean(item)} title="Detalhes da atividade" eyebrow="Registro imutável" size="large" onClose={onClose}>
    {item ? <div className="activity-detail">
      <div className="activity-detail-summary"><div><span>Responsável</span><strong>{actorLabel(item)}</strong><small>{item.actor_email_snapshot || originLabel(item.origin_type)}{item.actor_role ? ` · ${item.actor_role}` : ""}</small></div><div><span>Data e hora</span><strong>{dateTime.format(new Date(item.created_at))}</strong><small>America/Sao_Paulo</small></div></div>
      <dl className="activity-detail-grid"><div><dt>Ação</dt><dd>{actionLabels[item.action_type]} <small>{item.action}</small></dd></div><div><dt>Módulo</dt><dd>{moduleLabel(item.module)}</dd></div><div><dt>Entidade</dt><dd>{item.entity_label || item.entity_type}</dd></div><div><dt>Identificador</dt><dd className="activity-mono">{item.entity_id || "—"}</dd></div><div><dt>Origem</dt><dd>{originLabel(item.origin_type)} · {item.origin_name || actorLabel(item)}</dd></div><div><dt>Descrição</dt><dd>{item.description}</dd></div></dl>
      {item.reason ? <div className="activity-reason"><strong>Justificativa</strong><p>{item.reason}</p></div> : null}
      <section className="activity-diff"><h3>O que mudou</h3>{differences.length ? <div>{differences.map((difference) => <article key={difference.field}><strong>{difference.field}</strong><div><span>Antes</span><pre>{displayAuditValue(difference.before)}</pre></div><div><span>Depois</span><pre>{displayAuditValue(difference.after)}</pre></div></article>)}</div> : <p>Este evento não possui comparação de campos.</p>}</section>
      <details className="activity-technical"><summary>Detalhes técnicos sanitizados</summary><dl><div><dt>ID do log</dt><dd className="activity-mono">{item.id}</dd></div><div><dt>Request ID</dt><dd className="activity-mono">{item.request_id || "—"}</dd></div><div><dt>IP anonimizado</dt><dd>{item.ip_hash || "—"}</dd></div><div><dt>Agente</dt><dd>{item.user_agent_summary || "—"}</dd></div></dl><pre>{displayAuditValue({ antes: item.previous_data_sanitized, depois: item.new_data_sanitized, metadados: item.metadata_sanitized })}</pre></details>
    </div> : null}
  </PanelDrawer>;
}

function ActivityLoading() {
  return <div className="activity-list" aria-label="Carregando logs" aria-busy="true">{Array.from({ length: 6 }, (_, index) => <div className="activity-row activity-skeleton" key={index}><span /><div><i /><i /><i /></div></div>)}</div>;
}
