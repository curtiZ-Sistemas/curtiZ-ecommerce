"use client";

import {
  AlertTriangle,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Headphones,
  Inbox,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Truck,
  UserRound,
  Wrench
} from "lucide-react";
import Link from "next/link";
import React from "react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

type MetricName =
  | "newOrders"
  | "overdueOrders"
  | "waitingSeparation"
  | "waitingShipping"
  | "pendingKits"
  | "criticalStock"
  | "exchanges"
  | "returns"
  | "occurrences"
  | "support"
  | "pendingTasks";
type OperationMetrics = Record<MetricName, number>;
type OperationItem = {
  id: string;
  productName: string;
  sku: string;
  color?: string;
  size?: string;
  variant?: string;
  quantity?: number;
  expectedQuantity?: number;
  checkedQuantity?: number | null;
  divergenceReason?: string | null;
};
type OperationOrder = {
  id: string;
  publicCode: string;
  status: string;
  paymentConfirmed: boolean;
  customerName: string;
  address: null | {
    line: string;
    district: string;
    city: string;
    state: string;
    postalCode: string;
  };
  placedAt: string;
  items: OperationItem[];
  shipments: Array<{
    id: string;
    status: string;
    provider: string;
    service: string;
    trackingCode: string | null;
    labelReady: boolean;
  }>;
  history: Array<{ status: string; reason: string; createdAt: string }>;
  notes: Array<{ id: string; content: string; createdAt: string }>;
};
type OperationTask = {
  id: string;
  publicCode: string;
  taskType: string;
  priority: string;
  status: string;
  assignedToCurrentUser: boolean;
  assigned: boolean;
  dueAt: string | null;
  startedAt: string | null;
  createdAt: string;
  sourceCode: string;
  sourceStatus: string;
  items: OperationItem[];
};
type InventoryItem = {
  variantId: string;
  productName: string;
  sku: string;
  variant: string;
  available: number;
  reserved: number;
  damaged: number;
  minimum: number;
  ideal: number;
  critical: boolean;
};
type KitOrder = {
  id: string;
  publicCode: string;
  status: string;
  kitName: string;
  representativeCode: string;
  createdAt: string;
  items: OperationItem[];
};
type ReturnRecord = {
  id: string;
  publicCode: string;
  orderCode: string;
  reason: string;
  description: string;
  requestedResolution: string;
  status: string;
  requestedAt: string;
  items: Array<{
    id: string;
    productName: string;
    sku: string;
    quantity: number;
    condition: string | null;
    destination: string | null;
    inspectionResult: string | null;
  }>;
};
type Occurrence = {
  id: string;
  publicCode: string;
  category: string;
  priority: string;
  status: string;
  title: string;
  description: string;
  resolution: string | null;
  assignedToCurrentUser: boolean;
  createdAt: string;
};
type OperationsResponse = {
  ok: boolean;
  demo: boolean;
  message?: string;
  metrics: OperationMetrics;
  orders: OperationOrder[];
  tasks: OperationTask[];
  inventory: InventoryItem[];
  movements: Array<{
    id: string;
    variantId: string;
    type: string;
    quantity: number;
    previous: number;
    current: number;
    reason: string;
    createdAt: string;
  }>;
  kitOrders: KitOrder[];
  returns: ReturnRecord[];
  occurrences: Occurrence[];
  invoices: Array<{
    id: string;
    orderCode: string;
    type: string;
    status: string;
    reference: string | null;
    error: string | null;
    attempts: number;
    createdAt: string;
  }>;
  representatives: Array<{
    id: string;
    publicCode: string;
    status: string;
    regionCode: string | null;
    createdAt: string;
  }>;
  adjustments: Array<{
    id: string;
    publicCode: string;
    variantId: string;
    quantityDelta: number;
    reason: string;
    status: string;
    createdAt: string;
  }>;
  pagination: { page: number; pageSize: number; total: number };
};

const emptyMetrics: OperationMetrics = {
  newOrders: 0,
  overdueOrders: 0,
  waitingSeparation: 0,
  waitingShipping: 0,
  pendingKits: 0,
  criticalStock: 0,
  exchanges: 0,
  returns: 0,
  occurrences: 0,
  support: 0,
  pendingTasks: 0
};
const emptyResponse: OperationsResponse = {
  ok: true,
  demo: false,
  metrics: emptyMetrics,
  orders: [],
  tasks: [],
  inventory: [],
  movements: [],
  kitOrders: [],
  returns: [],
  occurrences: [],
  invoices: [],
  representatives: [],
  adjustments: [],
  pagination: { page: 1, pageSize: 20, total: 0 }
};

export function OperationalConsole({ section, initialQuery = "" }: { section: string; initialQuery?: string }) {
  const [data, setData] = useState<OperationsResponse>(emptyResponse);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(
    async (targetPage = page) => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        section,
        page: String(targetPage),
        ...(query.trim() ? { q: query.trim() } : {}),
        ...(status ? { status } : {})
      });
      try {
        const response = await fetch(`/api/operations?${params}`, { cache: "no-store" });
        const result = (await response.json()) as OperationsResponse;
        if (!response.ok || !result.ok) {
          throw new Error(result.message ?? "Não foi possível carregar a operação.");
        }
        setData(result);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Falha inesperada.");
      } finally {
        setLoading(false);
      }
    },
    [page, query, section, status]
  );

  useEffect(() => {
    setPage(1);
    void load(1);
  }, [section]);

  const run = async (body: Record<string, unknown>, success: string) => {
    if (processing || data.demo) {
      if (data.demo) setError("Ações indisponíveis enquanto não houver dados conectados.");
      return false;
    }
    setProcessing(String(body.action));
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message ?? "Ação não concluída.");
      setNotice(success);
      await load();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha inesperada.");
      return false;
    } finally {
      setProcessing("");
    }
  };

  if (loading) return <OperationalLoading />;
  if (error && !data.ok) {
    return (
      <HonestState icon={AlertTriangle} title="Operação indisponível" description={error}>
        <button className="primary-button" onClick={() => void load()}>
          <RefreshCw /> Tentar novamente
        </button>
      </HonestState>
    );
  }

  return (
    <div className="operational-console">
      {(notice || error) && (
        <p className={`operational-feedback ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>
          {error || notice}
        </p>
      )}
      {section ? (
        <Section
          section={section}
          data={data}
          query={query}
          status={status}
          processing={processing}
          setQuery={setQuery}
          setStatus={setStatus}
          search={() => {
            setPage(1);
            void load(1);
          }}
          run={run}
          changePage={(next) => {
            setPage(next);
            void load(next);
          }}
        />
      ) : (
        <Dashboard metrics={data.metrics} data={data} />
      )}
    </div>
  );
}

function Dashboard({ metrics, data }: { metrics: OperationMetrics; data: OperationsResponse }) {
  const cards: Array<[string, number, string, typeof PackageCheck]> = [
    ["Pedidos novos", metrics.newOrders, "pedidos?status=payment_approved", Inbox],
    ["Pedidos atrasados", metrics.overdueOrders, "pendencias", AlertTriangle],
    ["Aguardando separação", metrics.waitingSeparation, "separacao", ClipboardCheck],
    ["Aguardando envio", metrics.waitingShipping, "envio", Truck],
    ["Kits pendentes", metrics.pendingKits, "montagem-kits", PackageCheck],
    ["Estoque crítico", metrics.criticalStock, "estoque?status=critical", Boxes],
    ["Trocas", metrics.exchanges, "trocas", RotateCcw],
    ["Devoluções", metrics.returns, "devolucoes", RotateCcw],
    ["Ocorrências", metrics.occurrences, "ocorrencias", ShieldAlert],
    ["Atendimentos", metrics.support, "atendimentos", Headphones],
    ["Pendências", metrics.pendingTasks, "pendencias", AlertTriangle]
  ];
  const priorityCards = cards.slice(0, 4);
  const queueCards = cards.slice(4);
  return (
    <>
      <section className="operational-priority" aria-labelledby="operational-priority-title">
        <header className="dashboard-section-heading">
          <div>
            <span>Turno atual</span>
            <h2 id="operational-priority-title">Prioridades da operação</h2>
          </div>
          <p>Comece pelos pedidos atrasados e pelas próximas etapas de expedição.</p>
        </header>
        <div className="operational-metric-grid operational-primary-metrics">
          {priorityCards.map(([label, value, route, Icon]) => (
            <Link href={`/operacional/${route}`} className="operational-metric" key={label}>
              <Icon />
              <span>{label}</span>
              <strong>{value}</strong>
              <small>Abrir fila <ChevronRight /></small>
            </Link>
          ))}
        </div>
      </section>
      <section className="panel-card operational-queue-overview" aria-labelledby="operational-queues-title">
        <header className="dashboard-section-heading compact">
          <div>
            <span>Fluxos relacionados</span>
            <h2 id="operational-queues-title">Filas e pendências</h2>
          </div>
        </header>
        <nav className="operational-queue-shortcuts" aria-label="Filas operacionais">
          {queueCards.map(([label, value, route, Icon]) => (
            <Link href={`/operacional/${route}`} key={label}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
              <strong>{value.toLocaleString("pt-BR")}</strong>
              <ChevronRight aria-hidden="true" />
            </Link>
          ))}
        </nav>
      </section>
      <div className="operational-dashboard-grid">
        <section className="panel-card">
          <SectionHeading title="Próximas tarefas" description="Fila ordenada por prioridade e prazo." />
          <TaskList tasks={data.tasks.slice(0, 5)} compact />
        </section>
        <section className="panel-card">
          <SectionHeading title="Ocorrências abertas" description="Divergências que exigem acompanhamento." />
          <OccurrenceList occurrences={data.occurrences.slice(0, 5)} compact />
        </section>
      </div>
    </>
  );
}

function Section({
  section,
  data,
  query,
  status,
  processing,
  setQuery,
  setStatus,
  search,
  run,
  changePage
}: {
  section: string;
  data: OperationsResponse;
  query: string;
  status: string;
  processing: string;
  setQuery: (value: string) => void;
  setStatus: (value: string) => void;
  search: () => void;
  run: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  changePage: (page: number) => void;
}) {
  if (["pedidos"].includes(section)) {
    return (
      <Orders
        orders={data.orders}
        query={query}
        status={status}
        processing={processing}
        setQuery={setQuery}
        setStatus={setStatus}
        search={search}
        run={run}
        pagination={data.pagination}
        changePage={changePage}
      />
    );
  }
  if (["separacao", "expedicao", "envio"].includes(section)) {
    const taskType = section === "separacao" ? "separation" : section === "expedicao" ? "expedition" : "shipping";
    return (
      <>
        <SectionHeading
          title={section === "separacao" ? "Fila de separação" : section === "expedicao" ? "Expedição" : "Envios"}
          description="Conferência, divergências, responsável e conclusão auditada."
        />
        <TaskList
          tasks={data.tasks.filter((task) => task.taskType === taskType)}
          run={run}
          processing={processing}
        />
        <Pagination pagination={data.pagination} changePage={changePage} />
      </>
    );
  }
  if (section === "estoque" || section === "reposicao" || section === "danificados") {
    return (
      <Inventory
        items={
          section === "danificados"
            ? data.inventory.filter((item) => item.damaged > 0)
            : section === "reposicao"
              ? data.inventory.filter((item) => item.critical)
              : data.inventory
        }
        movements={data.movements}
        adjustments={data.adjustments}
        run={run}
        processing={processing}
      />
    );
  }
  if (["kits", "montagem-kits"].includes(section)) {
    return <Kits kits={data.kitOrders} run={run} processing={processing} />;
  }
  if (["trocas", "devolucoes"].includes(section)) {
    const list =
      section === "trocas"
        ? data.returns.filter((item) => item.requestedResolution === "exchange")
        : data.returns;
    return <Returns records={list} run={run} processing={processing} />;
  }
  if (section === "ocorrencias") {
    return <Occurrences occurrences={data.occurrences} run={run} processing={processing} />;
  }
  if (section === "notas-fiscais") return <Invoices invoices={data.invoices} />;
  if (section === "representantes") return <Representatives representatives={data.representatives} />;
  if (section === "pendencias") {
    return (
      <>
        <SectionHeading title="Pendências operacionais" description="Tarefas bloqueadas, atrasadas e ocorrências abertas." />
        <TaskList tasks={data.tasks.filter((task) => task.status !== "completed")} run={run} processing={processing} />
        <OccurrenceList occurrences={data.occurrences.filter((item) => !["resolved", "rejected"].includes(item.status))} />
      </>
    );
  }
  if (section === "relatorios-operacionais") {
    return <OperationalReports metrics={data.metrics} />;
  }
  return (
    <HonestState
      icon={Wrench}
      title="Fluxo operacional"
      description="Nenhum registro disponível para esta fila no estado atual."
    />
  );
}

function Orders({
  orders,
  query,
  status,
  processing,
  setQuery,
  setStatus,
  search,
  run,
  pagination,
  changePage
}: {
  orders: OperationOrder[];
  query: string;
  status: string;
  processing: string;
  setQuery: (value: string) => void;
  setStatus: (value: string) => void;
  search: () => void;
  run: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  pagination: OperationsResponse["pagination"];
  changePage: (page: number) => void;
}) {
  const [selected, setSelected] = useState("");
  const selectedOrder = orders.find((order) => order.id === selected) ?? null;
  return (
    <>
      <SectionHeading title="Pedidos" description="Somente dados necessários para executar a operação." />
      <form className="operational-filters" onSubmit={(event) => { event.preventDefault(); search(); }}>
        <label><Search /><span className="sr-only">Buscar pedido</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Código do pedido ou cliente" /></label>
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar status">
          <option value="">Todos os status</option>
          <option value="payment_approved">Pagamento aprovado</option>
          <option value="picking">Em separação</option>
          <option value="ready_to_ship">Pronto para envio</option>
          <option value="shipped">Enviado</option>
          <option value="manual_review">Revisão manual</option>
        </select>
        <button className="primary-button"><Search /> Buscar</button>
      </form>
      {orders.length ? (
        <div className="operational-list">
          {orders.map((order) => (
            <article className="operational-row" key={order.id}>
              <div>
                <strong>{order.publicCode}</strong>
                <small>{order.customerName} · {formatDateTime(order.placedAt)}</small>
              </div>
              <span className={`status ${statusTone(order.status)}`}>{label(order.status)}</span>
              <span>{order.items.reduce((sum, item) => sum + (item.quantity ?? 0), 0)} itens</span>
              <span className={order.paymentConfirmed ? "operation-ok" : "operation-warning"}>
                {order.paymentConfirmed ? "Pagamento confirmado" : "Pagamento não confirmado"}
              </span>
              <div className="operational-actions">
                <button className="secondary-button" onClick={() => setSelected(order.id)}>Detalhes</button>
                {order.paymentConfirmed && ["payment_approved", "processing", "picking"].includes(order.status) && (
                  <button className="primary-button" disabled={Boolean(processing)} onClick={() => void run({ action: "start_separation", orderId: order.id }, "Separação iniciada.")}>
                    <ClipboardCheck /> Separar
                  </button>
                )}
                {order.status === "ready_to_ship" && (
                  <button className="primary-button" disabled={Boolean(processing)} onClick={() => void run({ action: "start_dispatch", orderId: order.id, taskType: "expedition" }, "Expedição iniciada.")}>
                    <Truck /> Expedir
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : <Empty icon={Inbox} title="Nenhum pedido encontrado" />}
      <Pagination pagination={pagination} changePage={changePage} />
      {selectedOrder && <OrderDetail order={selectedOrder} close={() => setSelected("")} run={run} />}
    </>
  );
}

function OrderDetail({
  order,
  close,
  run
}: {
  order: OperationOrder;
  close: () => void;
  run: (body: Record<string, unknown>, success: string) => Promise<boolean>;
}) {
  const note = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = form.get("note");
    if (typeof value !== "string") return;
    if (await run({ action: "add_order_note", orderId: order.id, content: value }, "Observação registrada.")) {
      event.currentTarget.reset();
    }
  };
  return (
    <section className="operational-detail panel-card" aria-label={`Detalhes ${order.publicCode}`}>
      <header><div><small>Pedido</small><h2>{order.publicCode}</h2></div><button className="secondary-button" onClick={close}>Fechar</button></header>
      <div className="operational-detail-grid">
        <div><h3>Entrega</h3><p>{order.customerName}</p><p>{order.address ? `${order.address.line} · ${order.address.district} · ${order.address.city}/${order.address.state} · ${order.address.postalCode}` : "Endereço não disponível"}</p></div>
        <div><h3>Itens</h3>{order.items.map((item) => <p key={item.id}><strong>{item.quantity}×</strong> {item.productName} · {item.sku} · {[item.color, item.size].filter(Boolean).join(" · ")}</p>)}</div>
        <div><h3>Envio</h3>{order.shipments.length ? order.shipments.map((shipment) => <p key={shipment.id}>{shipment.provider} · {shipment.service} · {label(shipment.status)} {shipment.trackingCode ? `· ${shipment.trackingCode}` : ""}</p>) : <p>Remessa ainda não criada.</p>}</div>
        <div><h3>Histórico</h3>{order.history.length ? order.history.slice(0, 8).map((entry) => <p key={`${entry.createdAt}-${entry.status}`}>{formatDateTime(entry.createdAt)} · {label(entry.status)} · {entry.reason}</p>) : <p>Sem movimentações.</p>}</div>
      </div>
      <form className="operational-note-form" onSubmit={(event) => void note(event)}>
        <label>Observação operacional<textarea name="note" minLength={3} maxLength={1000} required /></label>
        <button className="primary-button"><Send /> Registrar</button>
      </form>
      {order.notes.map((item) => <p className="operational-note" key={item.id}>{formatDateTime(item.createdAt)} · {item.content}</p>)}
    </section>
  );
}

function TaskList({
  tasks,
  run,
  processing = "",
  compact = false
}: {
  tasks: OperationTask[];
  run?: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  processing?: string;
  compact?: boolean;
}) {
  const [selected, setSelected] = useState("");
  const selectedTask = tasks.find((task) => task.id === selected);
  if (!tasks.length) return <Empty icon={ClipboardCheck} title="Nenhuma tarefa nesta fila" />;
  return (
    <>
      <div className="operational-list">
        {tasks.map((task) => (
          <article className="operational-row task" key={task.id}>
            <div><strong>{task.sourceCode || task.publicCode}</strong><small>{label(task.taskType)} · {task.dueAt ? `Prazo ${formatDateTime(task.dueAt)}` : "Sem prazo configurado"}</small></div>
            <span className={`status ${statusTone(task.priority)}`}>{label(task.priority)}</span>
            <span className={`status ${statusTone(task.status)}`}>{label(task.status)}</span>
            {!compact && <span>{task.assignedToCurrentUser ? "Minha tarefa" : task.assigned ? "Atribuída" : "Sem responsável"}</span>}
            {!compact && run && (
              <div className="operational-actions">
                {!task.assigned && <button className="secondary-button" disabled={Boolean(processing)} onClick={() => void run({ action: "claim_task", taskId: task.id }, "Tarefa assumida.")}>Assumir</button>}
                <button className="secondary-button" onClick={() => setSelected(task.id)}>Conferir</button>
              </div>
            )}
          </article>
        ))}
      </div>
      {selectedTask && run && <TaskDetail task={selectedTask} close={() => setSelected("")} run={run} processing={processing} />}
    </>
  );
}

function TaskDetail({
  task,
  close,
  run,
  processing
}: {
  task: OperationTask;
  close: () => void;
  run: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  processing: string;
}) {
  return (
    <section className="operational-detail panel-card">
      <header><div><small>{label(task.taskType)}</small><h2>{task.sourceCode || task.publicCode}</h2></div><button className="secondary-button" onClick={close}>Fechar</button></header>
      {!task.assignedToCurrentUser ? (
        <p className="operational-feedback">Assuma a tarefa antes de registrar a conferência.</p>
      ) : (
        <>
          <div className="operational-check-list">
            {task.items.map((item) => <TaskItem item={item} run={run} processing={processing} key={item.id} />)}
          </div>
          <button className="primary-button" disabled={Boolean(processing)} onClick={() => void run({ action: "complete_task", taskId: task.id }, "Tarefa concluída.")}>
            <Check /> Concluir conferência
          </button>
        </>
      )}
    </section>
  );
}

function TaskItem({
  item,
  run,
  processing
}: {
  item: OperationItem;
  run: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  processing: string;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const quantity = Number(form.get("quantity"));
    const reasonValue = form.get("reason");
    const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";
    void run(
      {
        action: "check_item",
        taskItemId: item.id,
        checkedQuantity: quantity,
        ...(reason ? { divergenceReason: reason } : {})
      },
      "Item conferido."
    );
  };
  return (
    <form onSubmit={submit}>
      <div><strong>{item.productName}</strong><small>{item.sku} · {item.variant}</small></div>
      <label>Esperado <input value={item.expectedQuantity} readOnly /></label>
      <label>Conferido <input name="quantity" type="number" min={0} max={999} defaultValue={item.checkedQuantity ?? item.expectedQuantity} required /></label>
      <label>Divergência <input name="reason" maxLength={500} defaultValue={item.divergenceReason ?? ""} placeholder="Obrigatório se diferente" /></label>
      <button className="secondary-button" disabled={Boolean(processing)}><Check /> Salvar</button>
    </form>
  );
}

function Inventory({
  items,
  movements,
  adjustments,
  run,
  processing
}: {
  items: InventoryItem[];
  movements: OperationsResponse["movements"];
  adjustments: OperationsResponse["adjustments"];
  run: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  processing: string;
}) {
  const request = (item: InventoryItem) => {
    const quantity = window.prompt("Informe a diferença de quantidade (positiva ou negativa):");
    const reason = window.prompt("Informe o motivo detalhado do ajuste:");
    if (!quantity || !reason) return;
    void run(
      { action: "request_adjustment", variantId: item.variantId, quantityDelta: Number(quantity), reason },
      "Solicitação de ajuste registrada para aprovação."
    );
  };
  return (
    <>
      <SectionHeading title="Estoque operacional" description="Saldo, reservas, danos, mínimo e solicitações auditáveis." />
      {items.length ? <div className="operational-list">{items.map((item) => (
        <article className={`operational-row inventory ${item.critical ? "critical" : ""}`} key={item.variantId}>
          <div><strong>{item.productName}</strong><small>{item.sku} · {item.variant}</small></div>
          <span>Disponível <strong>{item.available}</strong></span>
          <span>Reservado <strong>{item.reserved}</strong></span>
          <span>Danificado <strong>{item.damaged}</strong></span>
          <span>Mínimo <strong>{item.minimum}</strong></span>
          <button className="secondary-button" disabled={Boolean(processing)} onClick={() => request(item)}>Solicitar ajuste</button>
        </article>
      ))}</div> : <Empty icon={Boxes} title="Nenhum item encontrado" />}
      <div className="operational-dashboard-grid">
        <section className="panel-card"><SectionHeading title="Movimentações recentes" description="Trilha registrada pelo estoque." />{movements.slice(0, 10).map((item) => <p className="operational-record" key={item.id}>{formatDateTime(item.createdAt)} · {item.reason} · {item.quantity > 0 ? "+" : ""}{item.quantity} · {item.previous} → {item.current}</p>)}</section>
        <section className="panel-card"><SectionHeading title="Ajustes solicitados" description="O Operacional não aprova o próprio ajuste." />{adjustments.length ? adjustments.map((item) => <p className="operational-record" key={item.id}>{item.publicCode} · {item.quantityDelta > 0 ? "+" : ""}{item.quantityDelta} · {label(item.status)}</p>) : <p className="operational-muted">Nenhuma solicitação.</p>}</section>
      </div>
    </>
  );
}

function Kits({
  kits,
  run,
  processing
}: {
  kits: KitOrder[];
  run: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  processing: string;
}) {
  return (
    <>
      <SectionHeading title="Kits de representantes" description="Montagem, conferência e expedição sem acesso a comissões." />
      {kits.length ? <div className="operational-list">{kits.map((kit) => (
        <article className="operational-row" key={kit.id}>
          <div><strong>{kit.publicCode}</strong><small>{kit.kitName} · {kit.representativeCode}</small></div>
          <span className={`status ${statusTone(kit.status)}`}>{label(kit.status)}</span>
          <span>{kit.items.reduce((sum, item) => sum + (item.quantity ?? 0), 0)} itens</span>
          <span>{formatDateTime(kit.createdAt)}</span>
          <div className="operational-actions">{["paid", "separating"].includes(kit.status) && <button className="primary-button" disabled={Boolean(processing)} onClick={() => void run({ action: "start_kit", kitOrderId: kit.id }, "Montagem do kit iniciada.")}><PackageCheck /> Montar</button>}</div>
        </article>
      ))}</div> : <Empty icon={PackageCheck} title="Nenhum kit pendente" />}
    </>
  );
}

function Returns({
  records,
  run,
  processing
}: {
  records: ReturnRecord[];
  run: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  processing: string;
}) {
  const inspect = (item: ReturnRecord["items"][number]) => {
    const condition = window.prompt("Descreva a condição física do produto:");
    if (!condition) return;
    const destination = window.prompt("Destino: sellable, damaged, discard ou supplier:", "damaged");
    if (!destination || !["sellable", "damaged", "discard", "supplier"].includes(destination)) return;
    const result = window.prompt("Registre o resultado da conferência:");
    if (!result) return;
    void run({ action: "inspect_return", returnItemId: item.id, condition, destination, result }, "Inspeção registrada.");
  };
  return (
    <>
      <SectionHeading title="Trocas e devoluções" description="Recebimento e inspeção física separados do estorno financeiro." />
      {records.length ? <div className="operational-return-grid">{records.map((record) => (
        <article className="panel-card" key={record.id}>
          <header><div><strong>{record.publicCode}</strong><small>Pedido {record.orderCode}</small></div><span className={`status ${statusTone(record.status)}`}>{label(record.status)}</span></header>
          <p><strong>Solicitação:</strong> {label(record.requestedResolution)}</p>
          <p>{record.reason} · {record.description}</p>
          {record.items.map((item) => <div className="return-item" key={item.id}><span><strong>{item.quantity}× {item.productName}</strong><small>{item.sku} · {item.condition ?? "Aguardando inspeção"}</small></span>{["received", "inspection"].includes(record.status) && <button className="secondary-button" disabled={Boolean(processing)} onClick={() => inspect(item)}>Inspecionar</button>}</div>)}
        </article>
      ))}</div> : <Empty icon={RotateCcw} title="Nenhuma solicitação nesta fila" />}
    </>
  );
}

function Occurrences({
  occurrences,
  run,
  processing
}: {
  occurrences: Occurrence[];
  run: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  processing: string;
}) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form);
    if (await run({ action: "create_occurrence", ...payload }, "Ocorrência registrada.")) {
      event.currentTarget.reset();
    }
  };
  const resolve = (item: Occurrence) => {
    const resolution = window.prompt("Descreva a resolução da ocorrência:");
    if (!resolution) return;
    void run({ action: "resolve_occurrence", occurrenceId: item.id, resolution, resolutionStatus: "resolved" }, "Ocorrência resolvida.");
  };
  return (
    <div className="operational-occurrence-layout">
      <form className="panel-card operational-occurrence-form" onSubmit={(event) => void submit(event)}>
        <SectionHeading title="Nova ocorrência" description="Registre somente dados necessários à operação." />
        <label>Categoria<select name="category" required defaultValue="divergence"><option value="divergence">Divergência</option><option value="damaged_product">Produto danificado</option><option value="missing_item">Item ausente</option><option value="shipping">Envio</option><option value="invoice">Nota fiscal</option><option value="return">Devolução</option><option value="exchange">Troca</option><option value="kit">Kit</option><option value="inventory">Estoque</option><option value="customer_service">Atendimento</option><option value="other">Outra</option></select></label>
        <label>Prioridade<select name="priority" defaultValue="normal"><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label>
        <label>Título<input name="title" minLength={5} maxLength={120} required /></label>
        <label>Descrição<textarea name="description" minLength={5} maxLength={2000} required /></label>
        <button className="primary-button" disabled={Boolean(processing)}>{processing ? <LoaderCircle className="spin" /> : <ShieldAlert />} Registrar</button>
      </form>
      <section className="panel-card"><SectionHeading title="Histórico de ocorrências" description="Fila por prioridade e status." /><OccurrenceList occurrences={occurrences} resolve={resolve} /></section>
    </div>
  );
}

function OccurrenceList({
  occurrences,
  compact = false,
  resolve
}: {
  occurrences: Occurrence[];
  compact?: boolean;
  resolve?: (item: Occurrence) => void;
}) {
  if (!occurrences.length) return <Empty icon={ShieldAlert} title="Nenhuma ocorrência aberta" />;
  return <div className="operational-list">{occurrences.map((item) => <article className="operational-row" key={item.id}><div><strong>{item.publicCode} · {item.title}</strong><small>{label(item.category)} · {formatDateTime(item.createdAt)}</small></div><span className={`status ${statusTone(item.priority)}`}>{label(item.priority)}</span><span className={`status ${statusTone(item.status)}`}>{label(item.status)}</span>{!compact && <p>{item.description}</p>}{resolve && !["resolved", "rejected"].includes(item.status) && <button className="secondary-button" onClick={() => resolve(item)}>Resolver</button>}</article>)}</div>;
}

function Invoices({ invoices }: { invoices: OperationsResponse["invoices"] }) {
  return (
    <>
      <SectionHeading title="Notas fiscais" description="Acompanhamento operacional sem chaves ou configurações do ERP." />
      {invoices.length ? <div className="operational-list">{invoices.map((invoice) => <article className="operational-row" key={invoice.id}><div><strong>{invoice.orderCode || "Pedido"}</strong><small>{label(invoice.type)} · {formatDateTime(invoice.createdAt)}</small></div><span className={`status ${statusTone(invoice.status)}`}>{label(invoice.status)}</span><span>{invoice.reference ?? "Sem referência"}</span><span>{invoice.error ? "Exige atenção" : `${invoice.attempts} tentativa(s)`}</span></article>)}</div> : <Empty icon={FileText} title="Nenhum documento fiscal" />}
    </>
  );
}

function Representatives({ representatives }: { representatives: OperationsResponse["representatives"] }) {
  return (
    <>
      <SectionHeading title="Representantes" description="Visão operacional mínima para kits e ocorrências; níveis e comissões não são expostos." />
      {representatives.length ? <div className="operational-list">{representatives.map((item) => <article className="operational-row" key={item.id}><div><strong>{item.publicCode}</strong><small>Região {item.regionCode ?? "não informada"}</small></div><span className={`status ${statusTone(item.status)}`}>{label(item.status)}</span><span>Desde {formatDate(item.createdAt)}</span></article>)}</div> : <Empty icon={UserRound} title="Nenhum representante encontrado" />}
    </>
  );
}

function OperationalReports({ metrics }: { metrics: OperationMetrics }) {
  const rows = [
    ["Pedidos aguardando separação", metrics.waitingSeparation],
    ["Pedidos aguardando envio", metrics.waitingShipping],
    ["Tarefas atrasadas", metrics.overdueOrders],
    ["Kits pendentes", metrics.pendingKits],
    ["Estoque crítico", metrics.criticalStock],
    ["Trocas abertas", metrics.exchanges],
    ["Devoluções abertas", metrics.returns],
    ["Ocorrências abertas", metrics.occurrences]
  ] as const;
  return (
    <>
      <SectionHeading title="Relatório operacional" description="Contagens atuais das filas; sem valores financeiros ou estratégia comercial." />
      <section className="panel-card operational-report">{rows.map(([name, value]) => <div key={name}><span>{name}</span><strong>{value}</strong></div>)}</section>
    </>
  );
}

function Pagination({
  pagination,
  changePage
}: {
  pagination: OperationsResponse["pagination"];
  changePage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="operational-pagination" aria-label="Paginação">
      <button className="secondary-button" disabled={pagination.page <= 1} onClick={() => changePage(pagination.page - 1)}><ChevronLeft /> Anterior</button>
      <span>Página {pagination.page} de {pages}</span>
      <button className="secondary-button" disabled={pagination.page >= pages} onClick={() => changePage(pagination.page + 1)}>Próxima <ChevronRight /></button>
    </nav>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <header className="operational-section-heading"><div><h2>{title}</h2><p>{description}</p></div></header>;
}
function Empty({ icon: Icon, title }: { icon: typeof Inbox; title: string }) {
  return <div className="operational-empty"><Icon /><strong>{title}</strong><small>A fila será atualizada quando houver registros confirmados.</small></div>;
}
function HonestState({
  icon: Icon,
  title,
  description,
  children
}: {
  icon: typeof Inbox;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return <div className="operational-empty"><Icon /><h2>{title}</h2><p>{description}</p>{children}</div>;
}
function OperationalLoading() {
  return <div className="operational-loading" aria-label="Carregando operação"><div /><div /><div /><div /></div>;
}

const formatDateTime = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo"
      }).format(new Date(value))
    : "Data não informada";
const formatDate = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value))
    : "Data não informada";
const label = (value: string) =>
  ({
    payment_approved: "Pagamento aprovado",
    processing: "Processando",
    picking: "Em separação",
    ready_to_ship: "Pronto para envio",
    shipped: "Enviado",
    delivered: "Entregue",
    manual_review: "Revisão manual",
    separation: "Separação",
    expedition: "Expedição",
    shipping: "Envio",
    kit_assembly: "Montagem de kit",
    kit_shipping: "Envio de kit",
    queued: "Na fila",
    in_progress: "Em andamento",
    blocked: "Bloqueada",
    completed: "Concluída",
    normal: "Normal",
    low: "Baixa",
    high: "Alta",
    urgent: "Urgente",
    paid: "Pago",
    separating: "Em separação",
    pending_payment: "Aguardando pagamento",
    requested: "Solicitada",
    in_review: "Em análise",
    received: "Recebida",
    inspection: "Em inspeção",
    exchange: "Troca",
    refund: "Reembolso",
    open: "Aberta",
    resolved: "Resolvida",
    rejected: "Recusada",
    pending: "Pendente",
    applied: "Aplicado",
    approved: "Aprovado",
    active: "Ativo",
    unqualified: "Não qualificado",
    suspended: "Suspenso",
    damaged_product: "Produto danificado",
    missing_item: "Item ausente",
    divergence: "Divergência",
    customer_service: "Atendimento"
  })[value] ?? value.replaceAll("_", " ");
const statusTone = (value: string) => {
  if (["completed", "delivered", "resolved", "approved", "active", "paid"].includes(value)) return "green";
  if (["high", "urgent", "blocked", "rejected", "suspended", "manual_review"].includes(value)) return "red";
  if (["in_progress", "picking", "ready_to_ship", "shipped", "separating"].includes(value)) return "blue";
  return "orange";
};
