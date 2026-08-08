"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  RefreshCw,
  Search
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  managerResources,
  type ManagerColumn,
  type ManagerResourceKey
} from "@/lib/manager-resources";

type Item = Record<string, unknown>;

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

export function ManagerResourceManager({ resource }: { resource: ManagerResourceKey }) {
  const definition = managerResources[resource];
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [auditActor, setAuditActor] = useState("");
  const [auditAction, setAuditAction] = useState("");
  const [auditModule, setAuditModule] = useState("");
  const [auditResult, setAuditResult] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const parameters = useMemo(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (submittedQuery) params.set("q", submittedQuery);
    if (status) params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (resource === "auditoria") {
      if (auditActor) params.set("actor", auditActor);
      if (auditAction) params.set("action", auditAction);
      if (auditModule) params.set("module", auditModule);
      if (auditResult) params.set("result", auditResult);
    }
    return params;
  }, [auditAction, auditActor, auditModule, auditResult, from, page, resource, status, submittedQuery, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/manager/resources/${resource}?${parameters}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!isItem(payload) || !response.ok) throw new Error("load_failed");
      setItems(Array.isArray(payload.items) ? payload.items.filter(isItem) : []);
      setTotal(numberValue(payload.total));
    } catch {
      setMessage("Não foi possível carregar os registros desta área.");
    } finally {
      setLoading(false);
    }
  }, [parameters, resource]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / 20));
  const hasCommissionWorkflow = resource === "fechamentos" || resource === "simulacoes";
  const hasRepresentativeWorkflow = resource === "representantes";
  const hasCampaignWorkflow = resource === "campanhas";

  const commissionAction = async (action: string, item?: Item, period?: { start: string; end: string }) => {
    let reason: string | undefined;
    if (action === "reopen") {
      reason = window.prompt("Informe a justificativa obrigatória para reabrir o fechamento:")?.trim();
      if (!reason) return;
    }

    setPending(true);
    setMessage("");
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
      setMessage(typeof payload.message === "string" ? payload.message : "Ação concluída.");
      await load();
    } catch {
      setMessage("A ação não foi concluída. Confira o estado atual e tente novamente.");
    } finally {
      setPending(false);
    }
  };

  const representativeAction = async (action: "suspend" | "reactivate", item: Item) => {
    const reason = window.prompt("Informe a justificativa obrigatória para esta alteração:")?.trim();
    if (!reason || typeof item.id !== "string") return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/manager/representatives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ representativeId: item.id, action, reason })
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isItem(payload)) throw new Error("action_failed");
      setMessage(typeof payload.message === "string" ? payload.message : "Situação atualizada.");
      await load();
    } catch {
      setMessage("Não foi possível alterar a situação deste representante.");
    } finally {
      setPending(false);
    }
  };

  const campaignAction = async (status: string, item: Item) => {
    const reason = window.prompt("Informe a justificativa obrigatória para esta transição:")?.trim();
    if (!reason || typeof item.id !== "string") return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/manager/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: item.id, status, reason })
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isItem(payload)) throw new Error("action_failed");
      setMessage(typeof payload.message === "string" ? payload.message : "Campanha atualizada.");
      await load();
    } catch {
      setMessage("Não foi possível alterar o estado desta campanha.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="panel-card admin-resource manager-resource">
      <header className="admin-resource-header">
        <div><h2>{definition.label}</h2><p>{definition.description}</p></div>
        {definition.exportAllowed ? (
          <a className="secondary-button" href={`/api/manager/resources/${resource}?${parameters}&format=csv`}>
            <Download aria-hidden="true" /> Exportar CSV
          </a>
        ) : null}
      </header>

      {hasCommissionWorkflow ? <SimulationForm disabled={pending} onSubmit={(period) => void commissionAction("simulate", undefined, period)} /> : null}

      <div className="admin-toolbar manager-resource-toolbar">
        <form className="admin-search" onSubmit={(event: FormEvent) => { event.preventDefault(); setPage(1); setSubmittedQuery(query.trim()); }}>
          <Search aria-hidden="true" />
          <label className="sr-only" htmlFor={`manager-search-${resource}`}>Buscar</label>
          <input id={`manager-search-${resource}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar registros" />
          <button className="secondary-button" type="submit">Buscar</button>
        </form>
        {definition.statusColumn && !definition.fixedStatus ? <input aria-label="Filtrar por status" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} placeholder="Status exato" /> : null}
        {definition.dateColumn ? <><input aria-label="Data inicial" type="date" value={from} onChange={(event) => { setPage(1); setFrom(event.target.value); }} /><input aria-label="Data final" type="date" value={to} onChange={(event) => { setPage(1); setTo(event.target.value); }} /></> : null}
        {resource === "auditoria" ? <><input aria-label="Filtrar por usuário" value={auditActor} onChange={(event) => { setPage(1); setAuditActor(event.target.value.trim()); }} placeholder="ID do usuário" /><input aria-label="Filtrar por ação" value={auditAction} onChange={(event) => { setPage(1); setAuditAction(event.target.value); }} placeholder="Ação exata" /><input aria-label="Filtrar por módulo" value={auditModule} onChange={(event) => { setPage(1); setAuditModule(event.target.value); }} placeholder="Módulo exato" /><input aria-label="Filtrar por resultado" value={auditResult} onChange={(event) => { setPage(1); setAuditResult(event.target.value); }} placeholder="Resultado exato" /></> : null}
        <button className="icon-button" type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar registros"><RefreshCw className={loading ? "spin" : ""} /></button>
      </div>

      {message ? <p className="admin-feedback" role="status">{message}</p> : null}
      {loading ? <div className="admin-loading"><LoaderCircle className="spin" /> Carregando</div> : items.length === 0 ? (
        <div className="admin-empty-state"><h3>Nenhum registro encontrado</h3><p>Não há dados reais para os filtros informados.</p></div>
      ) : (
        <div className="admin-table-wrap">
          <table className="data-table admin-data-table">
            <thead><tr>{definition.columns.map((column) => <th key={column.key}>{column.label}</th>)}{hasCommissionWorkflow || hasRepresentativeWorkflow || hasCampaignWorkflow ? <th>Ações</th> : null}</tr></thead>
            <tbody>{items.map((item, index) => (
              <tr key={typeof item.id === "string" ? item.id : `${resource}-${index}`}>
                {definition.columns.map((column) => <td key={column.key} data-label={column.label}>{display(item[column.key], column)}</td>)}
                {hasCommissionWorkflow ? <td className="manager-row-actions" data-label="Ações"><ClosingActions item={item} disabled={pending} run={(action) => void commissionAction(action, item)} /></td> : null}
                {hasRepresentativeWorkflow ? <td className="manager-row-actions" data-label="Ações"><RepresentativeActions item={item} disabled={pending} run={(action) => void representativeAction(action, item)} /></td> : null}
                {hasCampaignWorkflow ? <td className="manager-row-actions" data-label="Ações"><CampaignActions item={item} disabled={pending} run={(status) => void campaignAction(status, item)} /></td> : null}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <footer className="admin-pagination">
        <span>{total.toLocaleString("pt-BR")} registros</span>
        <div><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} aria-label="Página anterior"><ChevronLeft /></button><span>Página {page} de {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)} aria-label="Próxima página"><ChevronRight /></button></div>
      </footer>
    </section>
  );
}

function SimulationForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (period: { start: string; end: string }) => void }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  return <form className="manager-simulation" onSubmit={(event) => { event.preventDefault(); onSubmit({ start, end }); }}><strong>Nova simulação</strong><label>Início<input type="date" value={start} onChange={(event) => setStart(event.target.value)} required /></label><label>Fim<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} required /></label><button className="primary-button" type="submit" disabled={disabled}>Simular fechamento</button></form>;
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

function CampaignActions({ item, disabled, run }: { item: Item; disabled: boolean; run: (status: string) => void }) {
  const status = scalar(item.status);
  if (status === "draft") return <button className="secondary-button" type="button" disabled={disabled} onClick={() => run("pending_review")}>Enviar à revisão</button>;
  if (status === "pending_review") return <div className="manager-action-group"><button className="primary-button" type="button" disabled={disabled} onClick={() => run("approved")}>Aprovar</button><button className="secondary-button danger-button" type="button" disabled={disabled} onClick={() => run("rejected")}>Rejeitar</button></div>;
  if (status === "approved") return <div className="manager-action-group"><button className="secondary-button" type="button" disabled={disabled} onClick={() => run("scheduled")}>Agendar</button><button className="primary-button" type="button" disabled={disabled} onClick={() => run("published")}>Publicar</button></div>;
  if (status === "scheduled") return <button className="primary-button" type="button" disabled={disabled} onClick={() => run("published")}>Publicar</button>;
  if (status === "published") return <button className="secondary-button" type="button" disabled={disabled} onClick={() => run("archived")}>Arquivar</button>;
  return <span>—</span>;
}
