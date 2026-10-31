"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  Search,
  X
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  managerResources,
  type ManagerColumn,
  type ManagerResourceKey
} from "@/lib/manager-resources";
import { ManagementPageHeader, ManagementPeriodSelect } from "@/components/management-ui";
import { Code, LoadingBlock, StateMessage, StatusLabel, Toolbar, type UiTone } from "@/components/panel-ui";
import {
  managementPeriodFor,
  type ManagementPeriodPreset
} from "@/lib/management-period";
import { usePanelPrompt } from "./panel-prompt";

type Item = Record<string, unknown>;
type ManagerCapabilities = {
  export: boolean;
  manageClosings: boolean;
  manageRepresentatives: boolean;
  manageCreatives: boolean;
  approveCreatives: boolean;
  publishCreatives: boolean;
};
const noCapabilities: ManagerCapabilities = { export: false, manageClosings: false, manageRepresentatives: false, manageCreatives: false, approveCreatives: false, publishCreatives: false };

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const statusLabels: Record<string, string> = {
  active: "Ativo",
  inactive: "Inativo",
  true: "Sim",
  false: "Não",
  pending: "Pendente",
  pending_approval: "Aguardando aprovação",
  pending_review: "Em análise",
  approved: "Aprovado",
  payable: "Disponível para pagamento",
  paid: "Pago",
  simulating: "Simulação",
  locked: "Bloqueado",
  reopened: "Reaberto",
  failed: "Falhou",
  published: "Publicado",
  scheduled: "Agendado",
  archived: "Arquivado",
  cancelled: "Cancelado",
  refunded: "Reembolsado"
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

function display(value: unknown, column: ManagerColumn): string {
  if (value === null || value === undefined || value === "") return "—";
  if (column.format === "refunds") {
    if (!Array.isArray(value) || value.length === 0) return "—";
    let refunded = 0;
    for (const entry of value as unknown[]) {
      if (isItem(entry)) refunded += numberValue(entry.refunded_amount);
    }
    return currency.format(refunded);
  }
  if (column.format === "cents") return currency.format(numberValue(value) / 100);
  if (column.format === "money") return currency.format(numberValue(value));
  if (column.format === "status") {
    const status = scalar(value);
    return (statusLabels[status] ?? status) || "—";
  }
  if ((column.format === "date" || column.format === "datetime") && typeof value === "string") {
    const parsed = new Date(column.format === "date" ? `${value}T12:00:00-03:00` : value);
    if (!Number.isNaN(parsed.getTime())) return column.format === "date" ? date.format(parsed) : dateTime.format(parsed);
  }
  if (column.format === "json" && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "—";
    }
  }
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return scalar(value) || "—";
}

// Mesmo significado, mesmo tom em todo o painel. Valores desconhecidos ficam neutros.
const statusTones: Record<string, UiTone> = {
  active: "success",
  true: "success",
  approved: "success",
  paid: "success",
  published: "success",
  pending: "warning",
  pending_approval: "warning",
  pending_review: "warning",
  reopened: "warning",
  simulating: "warning",
  suspended: "warning",
  payable: "info",
  scheduled: "info",
  locked: "info",
  failed: "danger"
};

const numericFormats = new Set<ManagerColumn["format"]>(["money", "cents", "refunds"]);

function isNumericColumn(column: ManagerColumn) {
  return numericFormats.has(column.format) || column.key === "depth" || column.key === "rank";
}

function isCodeColumn(column: ManagerColumn) {
  return column.key === "public_code" || column.key === "provider_reference" || column.key === "reversal_of" || column.key.endsWith("_id");
}

function Cell({ value, column }: { value: unknown; column: ManagerColumn }): ReactNode {
  const text = display(value, column);
  if (text === "—") return <span className="manager-cell-empty">—</span>;
  if (column.format === "status") return <StatusLabel tone={statusTones[scalar(value)] ?? "neutral"}>{text}</StatusLabel>;
  if (column.format === "json" || isCodeColumn(column)) return <Code>{text}</Code>;
  return text;
}

export function ManagerResourceManager({ resource, initialQuery = "" }: { resource: ManagerResourceKey; initialQuery?: string }) {
  const requestPrompt = usePanelPrompt();
  const definition = managerResources[resource];
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [status, setStatus] = useState("");
  const [preset, setPreset] = useState<ManagementPeriodPreset>("custom");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [capabilities, setCapabilities] = useState<ManagerCapabilities>(noCapabilities);

  const parameters = useMemo(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (submittedQuery) params.set("q", submittedQuery);
    if (status) params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params;
  }, [from, page, status, submittedQuery, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/manager/resources/${resource}?${parameters}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!isItem(payload) || !response.ok) throw new Error("load_failed");
      setItems(Array.isArray(payload.items) ? payload.items.filter(isItem) : []);
      setTotal(numberValue(payload.total));
      setCapabilities(isItem(payload.capabilities) ? {
        export: payload.capabilities.export === true,
        manageClosings: payload.capabilities.manageClosings === true,
        manageRepresentatives: payload.capabilities.manageRepresentatives === true,
        manageCreatives: payload.capabilities.manageCreatives === true,
        approveCreatives: payload.capabilities.approveCreatives === true,
        publishCreatives: payload.capabilities.publishCreatives === true
      } : noCapabilities);
    } catch {
      setItems([]);
      setTotal(0);
      setCapabilities(noCapabilities);
      setLoadError("Não foi possível carregar os registros desta área.");
    } finally {
      setLoading(false);
    }
  }, [parameters, resource]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / 20));
  const changePreset = (next: ManagementPeriodPreset) => {
    setPreset(next);
    setPage(1);
    if (next === "custom") return;
    const period = managementPeriodFor(next);
    setFrom(period.from);
    setTo(period.to);
  };
  const hasCommissionWorkflow = (resource === "fechamentos" || resource === "simulacoes") && capabilities.manageClosings;
  const hasRepresentativeWorkflow = resource === "representantes" && capabilities.manageRepresentatives;
  const hasCampaignWorkflow = resource === "campanhas" && (capabilities.manageCreatives || capabilities.approveCreatives || capabilities.publishCreatives);

  const commissionAction = async (action: string, item?: Item, period?: { start: string; end: string }) => {
    let reason: string | undefined;
    if (action === "reopen") {
      reason = (await requestPrompt({
        title: "Reabrir fechamento",
        label: "Justificativa obrigatória",
        minLength: 3
      }))?.trim();
      if (!reason) return;
    }

    setPending(true);
    setMessage(null);
    try {
      const body = action === "simulate"
        ? { action, periodStart: period?.start, periodEnd: period?.end }
        : { action, closingId: item?.id, reason };
      const response = await fetch("/api/manager/commissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isItem(payload)) throw new Error("action_failed");
      setMessage({ kind: "success", text: typeof payload.message === "string" ? payload.message : "Ação concluída." });
      await load();
    } catch {
      setMessage({ kind: "error", text: "A ação não foi concluída. Confira o estado atual e tente novamente." });
    } finally {
      setPending(false);
    }
  };

  const representativeAction = async (action: "suspend" | "reactivate", item: Item) => {
    const reason = (await requestPrompt({
      title: action === "suspend" ? "Suspender representante" : "Reativar representante",
      label: "Justificativa obrigatória",
      minLength: 3
    }))?.trim();
    if (!reason || typeof item.id !== "string") return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/manager/representatives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ representativeId: item.id, action, reason })
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isItem(payload)) throw new Error("action_failed");
      setMessage({ kind: "success", text: typeof payload.message === "string" ? payload.message : "Situação atualizada." });
      await load();
    } catch {
      setMessage({ kind: "error", text: "Não foi possível alterar a situação deste representante." });
    } finally {
      setPending(false);
    }
  };

  const campaignAction = async (status: string, item: Item) => {
    const reason = (await requestPrompt({
      title: "Alterar campanha",
      label: "Justificativa obrigatória",
      minLength: 3
    }))?.trim();
    if (!reason || typeof item.id !== "string") return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/manager/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: item.id, status, reason })
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isItem(payload)) throw new Error("action_failed");
      setMessage({ kind: "success", text: typeof payload.message === "string" ? payload.message : "Campanha atualizada." });
      await load();
    } catch {
      setMessage({ kind: "error", text: "Não foi possível alterar o estado desta campanha." });
    } finally {
      setPending(false);
    }
  };

  const hasFilters = Boolean(query || submittedQuery || status || from || to);
  const clearFilters = () => { setQuery(""); setSubmittedQuery(""); setStatus(""); setPreset("custom"); setFrom(""); setTo(""); setPage(1); };
  const hasActions = hasCommissionWorkflow || hasRepresentativeWorkflow || hasCampaignWorkflow;
  const firstItem = total === 0 ? 0 : (page - 1) * 20 + 1;
  const lastItem = Math.min(page * 20, total);

  return (
    <section className="manager-resource" aria-busy={loading || pending}>
      <ManagementPageHeader
        title={definition.label}
        description={definition.description}
        actions={capabilities.export ? (
          <a className="secondary-button" href={`/api/manager/resources/${resource}?${parameters}&format=csv`}>
            <Download aria-hidden="true" /> Exportar CSV
          </a>
        ) : undefined}
      />

      {hasCommissionWorkflow ? <SimulationForm disabled={pending} onSubmit={(period) => void commissionAction("simulate", undefined, period)} /> : null}

      <Toolbar label="Busca e filtros" sticky>
        <form className="admin-search manager-resource-search" onSubmit={(event: FormEvent) => { event.preventDefault(); setPage(1); setSubmittedQuery(query.trim()); }}>
          <Search aria-hidden="true" />
          <label className="sr-only" htmlFor={`manager-search-${resource}`}>Buscar</label>
          <input id={`manager-search-${resource}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar registros" />
          <button className="secondary-button" type="submit">Buscar</button>
        </form>
        {definition.statusColumn && !definition.fixedStatus ? (
          <label className="management-field manager-resource-status">
            <span>Status</span>
            <input value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} placeholder="Status exato" aria-label="Filtrar por status" />
          </label>
        ) : null}
        {definition.dateColumn ? <div className="manager-resource-period">
          <ManagementPeriodSelect value={preset} onChange={changePreset} disabled={loading} />
          <label className="management-field"><span>De</span><input aria-label="Data inicial" type="date" value={from} onChange={(event) => { setPreset("custom"); setPage(1); setFrom(event.target.value); }} /></label>
          <label className="management-field"><span>Até</span><input aria-label="Data final" type="date" value={to} onChange={(event) => { setPreset("custom"); setPage(1); setTo(event.target.value); }} /></label>
        </div> : null}
        <div className="manager-resource-tools">
          {hasFilters ? <button className="ghost-button filter-clear-button" type="button" onClick={clearFilters}><X aria-hidden="true" /> Limpar filtros</button> : null}
          <button className="icon-button" type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar registros" title="Atualizar registros"><RefreshCw className={loading ? "spin" : ""} aria-hidden="true" /></button>
        </div>
      </Toolbar>

      {message ? <p className={`admin-feedback ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p> : null}
      <div className="manager-resource-body">
        {loading ? <LoadingBlock label="Carregando registros" rows={6} /> : loadError ? (
          <StateMessage kind="error" level={3} title="Consulta indisponível" description={loadError} action={<button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" /> Tentar novamente</button>} />
        ) : items.length === 0 ? (
          <StateMessage
            level={3}
            title="Nenhum registro encontrado"
            description="Não há dados reais para os filtros informados."
            action={hasFilters ? <button className="secondary-button" type="button" onClick={clearFilters}><X aria-hidden="true" /> Limpar filtros</button> : undefined}
          />
        ) : (
          <div className="manager-resource-table">
            <table className="data-table admin-data-table ui-table-stack">
              <thead><tr>{definition.columns.map((column) => <th key={column.key} className={isNumericColumn(column) ? "ui-num" : undefined} scope="col">{column.label}</th>)}{hasActions ? <th scope="col"><span className="sr-only">Ações</span></th> : null}</tr></thead>
              <tbody>{items.map((item, index) => (
                <tr key={typeof item.id === "string" ? item.id : `${resource}-${index}`}>
                  {definition.columns.map((column) => <td key={column.key} data-label={column.label} className={isNumericColumn(column) ? "ui-num" : undefined}><Cell value={item[column.key]} column={column} /></td>)}
                  {hasCommissionWorkflow ? <td className="manager-row-actions" data-label="Ações"><ClosingActions item={item} disabled={pending} run={(action) => void commissionAction(action, item)} /></td> : null}
                  {hasRepresentativeWorkflow ? <td className="manager-row-actions" data-label="Ações"><RepresentativeActions item={item} disabled={pending} run={(action) => void representativeAction(action, item)} /></td> : null}
                  {hasCampaignWorkflow ? <td className="manager-row-actions" data-label="Ações"><CampaignActions item={item} disabled={pending} capabilities={capabilities} run={(status) => void campaignAction(status, item)} /></td> : null}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      <footer className="admin-pagination manager-pagination">
        <span className="ui-num">{total === 0 ? "0 registros" : `${firstItem.toLocaleString("pt-BR")}–${lastItem.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")}`}</span>
        <div><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} aria-label="Página anterior" title="Página anterior"><ChevronLeft aria-hidden="true" /></button><span>Página {page} de {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)} aria-label="Próxima página" title="Próxima página"><ChevronRight aria-hidden="true" /></button></div>
      </footer>
    </section>
  );
}

function SimulationForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (period: { start: string; end: string }) => void }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  return (
    <form className="manager-simulation" aria-labelledby="manager-simulation-title" onSubmit={(event) => { event.preventDefault(); onSubmit({ start, end }); }}>
      <div className="manager-simulation-copy">
        <h2 id="manager-simulation-title">Nova simulação</h2>
        <p>Informe o período do fechamento de comissões a simular.</p>
      </div>
      <label className="management-field">Início<input type="date" value={start} onChange={(event) => setStart(event.target.value)} required /></label>
      <label className="management-field">Fim<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} required /></label>
      <button className="primary-button" type="submit" disabled={disabled}>Simular fechamento</button>
    </form>
  );
}

function ClosingActions({ item, disabled, run }: { item: Item; disabled: boolean; run: (action: string) => void }) {
  const status = scalar(item.status);
  if (status === "simulating" || status === "reopened") return <button className="secondary-button" type="button" disabled={disabled} onClick={() => run("submit")}>Enviar para aprovação</button>;
  if (status === "pending_approval") return <button className="primary-button" type="button" disabled={disabled} onClick={() => run("approve")}>Aprovar</button>;
  if (status === "approved") return <button className="primary-button" type="button" disabled={disabled} onClick={() => run("lock")}>Bloquear período</button>;
  if (status === "locked" || status === "paid") return <button className="secondary-button" type="button" disabled={disabled} onClick={() => run("reopen")}>Reabrir</button>;
  return <span>—</span>;
}

function RepresentativeActions({ item, disabled, run }: { item: Item; disabled: boolean; run: (action: "suspend" | "reactivate") => void }) {
  const status = scalar(item.status);
  if (["active", "inactive", "unqualified"].includes(status)) return <button className="secondary-button danger-button" type="button" disabled={disabled} onClick={() => run("suspend")}>Suspender</button>;
  if (status === "suspended") return <button className="primary-button" type="button" disabled={disabled} onClick={() => run("reactivate")}>Reativar</button>;
  return <span>—</span>;
}

function CampaignActions({ item, disabled, capabilities, run }: { item: Item; disabled: boolean; capabilities: ManagerCapabilities; run: (status: string) => void }) {
  const status = scalar(item.status);
  if (status === "draft" && capabilities.manageCreatives) return <button className="secondary-button" type="button" disabled={disabled} onClick={() => run("pending_review")}>Enviar à revisão</button>;
  if (status === "pending_review" && capabilities.approveCreatives) return <div className="manager-action-group"><button className="primary-button" type="button" disabled={disabled} onClick={() => run("approved")}>Aprovar</button><button className="secondary-button danger-button" type="button" disabled={disabled} onClick={() => run("rejected")}>Rejeitar</button></div>;
  if (status === "approved" && capabilities.publishCreatives) return <div className="manager-action-group"><button className="secondary-button" type="button" disabled={disabled} onClick={() => run("scheduled")}>Agendar</button><button className="primary-button" type="button" disabled={disabled} onClick={() => run("published")}>Publicar</button></div>;
  if (status === "scheduled" && capabilities.publishCreatives) return <button className="primary-button" type="button" disabled={disabled} onClick={() => run("published")}>Publicar</button>;
  if (status === "published" && capabilities.publishCreatives) return <button className="secondary-button" type="button" disabled={disabled} onClick={() => run("archived")}>Arquivar</button>;
  return <span>—</span>;
}
