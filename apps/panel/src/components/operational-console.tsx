"use client";

import {
  AlertTriangle,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileText,
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
  Wrench,
  X
} from "lucide-react";
import Link from "next/link";
import { BlingOperational } from "./bling-operational";
import { PanelDrawer } from "./panel-drawer";
import { usePanelConfirm } from "./panel-prompt";
import { Code, Kpi, KpiStrip, SectionHeader, StateMessage, StatusLabel, type UiTone } from "./panel-ui";
import React from "react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

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
type OperationCapabilities = {
  executeTasks: boolean;
  fulfillKits: boolean;
  createOccurrences: boolean;
  resolveOccurrences: boolean;
  requestAdjustments: boolean;
  inspectReturns: boolean;
  addOrderNotes: boolean;
};
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
    carrier: string;
    trackingCode: string | null;
    labelReady: boolean;
    operationState: string;
    shippingAmount: number;
    shippingCost: number;
    estimatedDays: number | null;
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
  warning?: string;
  capabilities: OperationCapabilities;
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
type Run = (body: Record<string, unknown>, success: string) => Promise<boolean>;

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
  ok: false,
  demo: false,
  metrics: emptyMetrics,
  capabilities: { executeTasks: false, fulfillKits: false, createOccurrences: false, resolveOccurrences: false, requestAdjustments: false, inspectReturns: false, addOrderNotes: false },
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

export function OperationalConsole({ section, initialQuery = "", initialStatus = "" }: { section: string; initialQuery?: string; initialStatus?: string }) {
  const [data, setData] = useState<OperationsResponse>(emptyResponse);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState(initialStatus);
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
        setError(result.warning ?? "");
      } catch (reason) {
        setData(emptyResponse);
        setError(reason instanceof Error ? reason.message : "Falha inesperada.");
      } finally {
        setLoading(false);
      }
    },
    [page, query, section, status]
  );

  useEffect(() => {
    setPage(1);
    setData(emptyResponse);
    void load(1);
  }, [section]);

  const run: Run = async (body, success) => {
    if (processing || data.demo) {
      if (data.demo) setError("Ações indisponíveis enquanto não houver dados conectados.");
      return false;
    }
    setProcessing(String(body.action));
    setError("");
    setNotice("");
    try {
      const action = String(body.action);
      const shippingAction = action.startsWith("shipping_");
      const response = await fetch(shippingAction ? "/api/operations/shipping" : "/api/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(shippingAction ? { ...body, action: action.slice("shipping_".length) } : body)
      });
      const result = (await response.json()) as { ok: boolean; message?: string; data?: { url?: string } };
      if (!response.ok || !result.ok) throw new Error(result.message ?? "Ação não concluída.");
      if (result.data?.url && /^https:\/\/(sandbox\.)?melhorenvio\.com\.br\//u.test(result.data.url)) {
        window.open(result.data.url, "_blank", "noopener,noreferrer");
      }
      setNotice(result.message ?? success);
      await load();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha inesperada.");
      return false;
    } finally {
      setProcessing("");
    }
  };

  if (loading) return <OperationalLoading dashboard={!section} />;
  if (error && !data.ok) {
    return (
      <StateMessage
        kind="error"
        icon={AlertTriangle}
        title="Operação indisponível"
        description={error}
        action={
          <button className="primary-button" type="button" onClick={() => void load()}>
            <RefreshCw aria-hidden="true" /> Tentar novamente
          </button>
        }
      />
    );
  }

  return (
    <div className="operational-console">
      {data.demo ? (
        <p className="admin-feedback info operational-banner" role="status">
          <Inbox aria-hidden="true" />
          <span>Dados de demonstração. As ações ficam indisponíveis enquanto não houver dados conectados.</span>
        </p>
      ) : null}
      {(notice || error) && (
        <p className={`admin-feedback operational-banner ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>
          {error ? <AlertTriangle aria-hidden="true" /> : <Check aria-hidden="true" />}
          <span>{error || notice}</span>
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
          capabilities={data.capabilities}
        />
      ) : (
        <Dashboard metrics={data.metrics} data={data} />
      )}
    </div>
  );
}

function Dashboard({ metrics, data }: { metrics: OperationMetrics; data: OperationsResponse }) {
  const queues: Array<[string, number, string]> = [
    ["Kits pendentes", metrics.pendingKits, "montagem-kits"],
    ["Estoque crítico", metrics.criticalStock, "reposicao"],
    ["Trocas", metrics.exchanges, "trocas"],
    ["Devoluções", metrics.returns, "devolucoes"],
    ["Ocorrências", metrics.occurrences, "ocorrencias"],
    ["Atendimentos", metrics.support, "atendimentos"],
    ["Pendências", metrics.pendingTasks, "pendencias"]
  ];
  return (
    <>
      <section className="operational-block" aria-labelledby="operational-priority-title">
        <SectionHeader
          id="operational-priority-title"
          title="Turno atual"
          description="Comece pelos pedidos atrasados e pelas próximas etapas de expedição."
        />
        <KpiStrip label="Prioridades da operação">
          <Kpi label="Pedidos novos" value={formatCount(metrics.newOrders)} detail="Pagamento aprovado" href="/operacional/pedidos?status=payment_approved" />
          <Kpi
            label="Pedidos atrasados"
            value={formatCount(metrics.overdueOrders)}
            tone={metrics.overdueOrders > 0 ? "danger" : "neutral"}
            detail={
              metrics.overdueOrders > 0 ? (
                <StatusLabel tone="danger" icon={AlertTriangle}>Atrasados: resolver primeiro</StatusLabel>
              ) : (
                "Nenhum pedido atrasado"
              )
            }
            href="/operacional/pendencias"
          />
          <Kpi label="Aguardando separação" value={formatCount(metrics.waitingSeparation)} detail="Fila de separação" href="/operacional/separacao" />
          <Kpi label="Aguardando envio" value={formatCount(metrics.waitingShipping)} detail="Fila de envio" href="/operacional/envio" />
        </KpiStrip>
      </section>
      <section className="operational-block" aria-labelledby="operational-queues-title">
        <SectionHeader id="operational-queues-title" title="Filas e pendências" />
        <nav aria-label="Filas operacionais">
          <ul className="operational-queue-list">
            {queues.map(([name, value, route]) => (
              <li key={name}>
                <Link href={`/operacional/${route}`}>
                  <span>{name}</span>
                  <strong className="ui-num">{formatCount(value)}</strong>
                  <ChevronRight aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>
      <div className="operational-dashboard-grid">
        <section className="operational-block" aria-labelledby="operational-next-tasks-title">
          <SectionHeader id="operational-next-tasks-title" title="Próximas tarefas" description="Fila ordenada por prioridade e prazo." />
          <TaskList tasks={data.tasks.slice(0, 5)} compact />
        </section>
        <section className="operational-block" aria-labelledby="operational-open-occurrences-title">
          <SectionHeader id="operational-open-occurrences-title" title="Ocorrências abertas" description="Divergências que exigem acompanhamento." />
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
  changePage,
  capabilities
}: {
  section: string;
  data: OperationsResponse;
  query: string;
  status: string;
  processing: string;
  setQuery: (value: string) => void;
  setStatus: (value: string) => void;
  search: () => void;
  run: Run;
  changePage: (page: number) => void;
  capabilities: OperationCapabilities;
}) {
  if (["pedidos"].includes(section)) {
    return (
      <>
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
          capabilities={capabilities}
        />
        <BlingOperational />
      </>
    );
  }
  if (["separacao", "expedicao", "envio"].includes(section)) {
    const taskType = section === "separacao" ? "separation" : section === "expedicao" ? "expedition" : "shipping";
    const tasks = data.tasks.filter((task) => task.taskType === taskType);
    return (
      <>
        <ResultCount count={tasks.length} singular="tarefa" plural="tarefas" />
        <TaskList tasks={tasks} run={run} processing={processing} canExecute={capabilities.executeTasks} />
        <Pagination pagination={data.pagination} changePage={changePage} />
      </>
    );
  }
  if (section === "estoque" || section === "reposicao" || section === "danificados") {
    return (
      <Inventory
        section={section}
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
        canRequest={capabilities.requestAdjustments}
      />
    );
  }
  if (["kits", "montagem-kits"].includes(section)) {
    return <Kits kits={data.kitOrders} run={run} processing={processing} canExecute={capabilities.executeTasks && capabilities.fulfillKits} />;
  }
  if (["trocas", "devolucoes"].includes(section)) {
    const list =
      section === "trocas"
        ? data.returns.filter((item) => item.requestedResolution === "exchange")
        : data.returns;
    return <Returns records={list} run={run} processing={processing} canInspect={capabilities.inspectReturns} />;
  }
  if (section === "ocorrencias") {
    return <Occurrences occurrences={data.occurrences} run={run} processing={processing} canCreate={capabilities.createOccurrences} canResolve={capabilities.resolveOccurrences} />;
  }
  if (section === "notas-fiscais") return <Invoices invoices={data.invoices} />;
  if (section === "representantes") return <Representatives representatives={data.representatives} />;
  if (section === "pendencias") {
    const openTasks = data.tasks.filter((task) => task.status !== "completed");
    const openOccurrences = data.occurrences.filter((item) => !["resolved", "rejected"].includes(item.status));
    return (
      <>
        <section className="operational-block" aria-labelledby="operational-blocked-title">
          <SectionHeader
            id="operational-blocked-title"
            title="Pedidos bloqueados"
            description="Bloqueados para separação e despacho até a confirmação do cancelamento ou reembolso."
            actions={<CountLabel count={data.orders.length} />}
          />
          {data.orders.length ? (
            <div className="operational-list">
              {data.orders.map((order) => (
                <article className="operational-item" key={order.id}>
                  <div className="operational-item-main">
                    <div className="operational-item-title">
                      <Code>{order.publicCode}</Code>
                      <StatusLabel tone="danger" icon={AlertTriangle}>{label(order.status)}</StatusLabel>
                    </div>
                    <p className="operational-item-meta">{order.customerName} · {formatDateTime(order.placedAt)}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <StateMessage compact level={3} icon={Inbox} title="Nenhum pedido bloqueado" description="Pedidos com cancelamento ou reembolso em andamento aparecem aqui." />
          )}
        </section>
        <section className="operational-block" aria-labelledby="operational-open-tasks-title">
          <SectionHeader id="operational-open-tasks-title" title="Tarefas em aberto" actions={<CountLabel count={openTasks.length} />} />
          <TaskList tasks={openTasks} run={run} processing={processing} canExecute={capabilities.executeTasks} />
        </section>
        <section className="operational-block" aria-labelledby="operational-pending-occurrences-title">
          <SectionHeader id="operational-pending-occurrences-title" title="Ocorrências sem resolução" actions={<CountLabel count={openOccurrences.length} />} />
          <OccurrenceList occurrences={openOccurrences} />
        </section>
        <BlingOperational />
      </>
    );
  }
  if (section === "relatorios-operacionais") {
    return <OperationalReports metrics={data.metrics} />;
  }
  return (
    <StateMessage
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
  changePage,
  capabilities
}: {
  orders: OperationOrder[];
  query: string;
  status: string;
  processing: string;
  setQuery: (value: string) => void;
  setStatus: (value: string) => void;
  search: () => void;
  run: Run;
  pagination: OperationsResponse["pagination"];
  changePage: (page: number) => void;
  capabilities: OperationCapabilities;
}) {
  const [selected, setSelected] = useState("");
  const selectedOrder = orders.find((order) => order.id === selected) ?? null;
  const filtered = Boolean(query.trim() || status);
  return (
    <section className="operational-block" aria-label="Fila de pedidos">
      <form className="ui-toolbar operational-toolbar" data-sticky="" role="search" onSubmit={(event) => { event.preventDefault(); search(); }}>
        <label className="operational-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Buscar pedido</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Código do pedido ou cliente" />
        </label>
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar status">
          <option value="">Todos os status</option>
          <option value="payment_approved">Pagamento aprovado</option>
          <option value="picking">Em separação</option>
          <option value="ready_to_ship">Pronto para envio</option>
          <option value="shipped">Enviado</option>
          <option value="manual_review">Revisão manual</option>
          <option value="cancelled">Cancelado</option>
          <option value="refunded">Reembolsado</option>
        </select>
        <button className="secondary-button" type="submit"><Search aria-hidden="true" /> Buscar</button>
        <ResultCount count={pagination.total} singular="pedido" plural="pedidos" />
      </form>
      {orders.length ? (
        <div className="operational-list">
          {orders.map((order) => {
            const itemCount = order.items.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
            return (
              <article className="operational-item" key={order.id}>
                <div className="operational-item-main">
                  <div className="operational-item-title">
                    <Code>{order.publicCode}</Code>
                    <StatusLabel tone={statusTone(order.status)}>{label(order.status)}</StatusLabel>
                  </div>
                  <p className="operational-item-meta">
                    {order.customerName} · {formatDateTime(order.placedAt)} · <span className="ui-num">{itemCount}</span> {itemCount === 1 ? "item" : "itens"}
                  </p>
                  <div className="operational-item-tags">
                    <StatusLabel tone={order.paymentConfirmed ? "success" : "warning"}>
                      {order.paymentConfirmed ? "Pagamento confirmado" : "Pagamento não confirmado"}
                    </StatusLabel>
                    <OrderProgress order={order} />
                  </div>
                </div>
                <div className="operational-actions">
                  <button className="secondary-button" type="button" onClick={() => setSelected(order.id)}>Detalhes</button>
                  {capabilities.executeTasks && ["pending_payment", "payment_approved", "processing", "picking", "ready_to_ship"].includes(order.status) && (
                    <button className="secondary-button" type="button" disabled={Boolean(processing)} onClick={() => {
                      const reason = window.prompt("Motivo do cancelamento (mínimo 5 caracteres). O pagamento e eventual reembolso serão verificados no provedor.");
                      if (reason && reason.trim().length >= 5 && window.confirm("Confirmar a solicitação de cancelamento deste pedido?"))
                        void run({ action: "cancel_order", orderId: order.id, reason: reason.trim() }, "Cancelamento solicitado. Acompanhe a confirmação e eventual reembolso.");
                    }}>Solicitar cancelamento</button>
                  )}
                  {capabilities.executeTasks && order.paymentConfirmed && ["payment_approved", "processing", "picking"].includes(order.status) && (
                    <button className="primary-button" type="button" disabled={Boolean(processing)} onClick={() => void run({ action: "start_separation", orderId: order.id }, "Separação iniciada.")}>
                      {processing === "start_separation" ? <LoaderCircle className="spin" aria-hidden="true" /> : <ClipboardCheck aria-hidden="true" />} Separar
                    </button>
                  )}
                  {capabilities.executeTasks && order.status === "ready_to_ship" && (
                    <button className="primary-button" type="button" disabled={Boolean(processing)} onClick={() => void run({ action: "start_dispatch", orderId: order.id, taskType: "expedition" }, "Expedição iniciada.")}>
                      {processing === "start_dispatch" ? <LoaderCircle className="spin" aria-hidden="true" /> : <Truck aria-hidden="true" />} Expedir
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <StateMessage
          compact
          icon={Inbox}
          title={filtered ? "Nenhum pedido corresponde à busca" : "Nenhum pedido encontrado"}
          description={filtered ? "Altere o termo ou o status e busque novamente." : "A fila será atualizada quando houver registros confirmados."}
        />
      )}
      <Pagination pagination={pagination} changePage={changePage} />
      {selectedOrder && <OrderDetail order={selectedOrder} close={() => setSelected("")} run={run} processing={processing} canAddNote={capabilities.addOrderNotes} />}
    </section>
  );
}

const orderStages = ["Pago", "Separação", "Expedição", "Envio"] as const;
const orderStageIndex: Record<string, number> = {
  payment_approved: 0,
  processing: 0,
  picking: 1,
  ready_to_ship: 2,
  shipped: 3,
  delivered: 3
};
const stageStateText = { done: "concluída", current: "em andamento", todo: "pendente" } as const;

/** Etapas visuais derivadas apenas do status existente; status fora do fluxo não exibem etapas. */
function OrderProgress({ order }: { order: OperationOrder }) {
  const reached = orderStageIndex[order.status];
  if (reached === undefined) return null;
  return (
    <ol className="operational-steps" aria-label="Etapas do pedido">
      {orderStages.map((stage, index) => {
        const finished = index < reached || (index === reached && (index === 0 ? order.paymentConfirmed : index === orderStages.length - 1));
        const state = finished ? "done" : index === reached ? "current" : "todo";
        return (
          <li key={stage} data-state={state} aria-current={state === "current" ? "step" : undefined}>
            <span className="sr-only">Etapa {stageStateText[state]}: </span>
            {stage}
          </li>
        );
      })}
    </ol>
  );
}

function OrderDetail({
  order,
  close,
  run,
  processing,
  canAddNote
}: {
  order: OperationOrder;
  close: () => void;
  run: Run;
  processing: string;
  canAddNote: boolean;
}) {
  const confirm = usePanelConfirm();
  const busy = Boolean(processing);
  const note = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const value = form.get("note");
    if (typeof value !== "string") return;
    if (await run({ action: "add_order_note", orderId: order.id, content: value }, "Observação registrada.")) {
      formElement.reset();
    }
  };
  const purchase = async (shipmentId: string) => {
    const accepted = await confirm({
      title: "Comprar etiqueta?",
      description: "A compra da etiqueta desta remessa será solicitada ao Melhor Envio.",
      confirmLabel: "Comprar etiqueta"
    });
    if (accepted) void run({ action: "shipping_purchase", shipmentId }, "Compra da etiqueta solicitada.");
  };
  const cancel = async (shipmentId: string) => {
    const accepted = await confirm({
      title: "Cancelar remessa?",
      description: "O cancelamento desta remessa será solicitado ao Melhor Envio.",
      confirmLabel: "Cancelar remessa",
      cancelLabel: "Manter remessa",
      tone: "danger"
    });
    if (accepted) void run({ action: "shipping_cancel", shipmentId, reason: "Cancelamento solicitado pela operação" }, "Cancelamento solicitado.");
  };
  return (
    <PanelDrawer open title={order.publicCode} eyebrow="Pedido" busy={busy} onClose={close}>
      <div className="operational-detail">
        <div className="operational-item-tags">
          <StatusLabel tone={statusTone(order.status)}>{label(order.status)}</StatusLabel>
          <OrderProgress order={order} />
        </div>
        <section className="operational-detail-section">
          <h3>Entrega</h3>
          <p>{order.customerName}</p>
          <p className="operational-muted">{order.address ? `${order.address.line} · ${order.address.district} · ${order.address.city}/${order.address.state} · ${order.address.postalCode}` : "Endereço não disponível"}</p>
        </section>
        <section className="operational-detail-section">
          <h3>Itens</h3>
          <ul className="operational-detail-items">
            {order.items.map((item) => (
              <li key={item.id}>
                <strong className="ui-num">{item.quantity}×</strong>
                <span>
                  {item.productName}
                  <small><Code>{item.sku}</Code>{[item.color, item.size].filter(Boolean).length ? ` · ${[item.color, item.size].filter(Boolean).join(" · ")}` : ""}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="operational-detail-section">
          <h3>Envio</h3>
          {order.shipments.length ? order.shipments.map((shipment) => (
            <div className="operational-shipment" key={shipment.id}>
              <p>
                {shipment.carrier || shipment.provider} · {shipment.service} · {label(shipment.status)}
                {shipment.trackingCode ? <> · <Code>{shipment.trackingCode}</Code></> : null}
              </p>
              <p className="operational-muted">
                Cobrado <span className="ui-num">{formatCurrency(shipment.shippingAmount)}</span> · custo <span className="ui-num">{formatCurrency(shipment.shippingCost)}</span>
                {shipment.estimatedDays ? ` · ${shipment.estimatedDays} dias úteis` : ""}
              </p>
              {canAddNote && shipment.provider === "melhorenvio" ? (
                <div className="operational-shipping-actions">
                  {["pending", "awaiting_invoice", "failed"].includes(shipment.operationState) ? <button className="primary-button" type="button" disabled={busy} onClick={() => void run({ action: "shipping_create", shipmentId: shipment.id }, "Envio criado no Melhor Envio.")}>Criar</button> : null}
                  {shipment.operationState === "created" ? <button className="primary-button" type="button" disabled={busy} onClick={() => void purchase(shipment.id)}>Comprar</button> : null}
                  {shipment.operationState === "purchased" ? <button className="primary-button" type="button" disabled={busy} onClick={() => void run({ action: "shipping_generate", shipmentId: shipment.id }, "Etiqueta gerada.")}>Gerar</button> : null}
                  {shipment.operationState === "generated" ? <button className="primary-button" type="button" disabled={busy} onClick={() => void run({ action: "shipping_print", shipmentId: shipment.id }, "Impressão autorizada.")}>Imprimir</button> : null}
                  {["purchased", "generated"].includes(shipment.operationState) ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void run({ action: "shipping_preview", shipmentId: shipment.id }, "Pré-visualização autorizada.")}>Visualizar</button> : null}
                  {shipment.operationState !== "pending" ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void run({ action: "shipping_sync", shipmentId: shipment.id }, "Remessa sincronizada.")}>Sincronizar</button> : null}
                  {["created", "purchased", "generated"].includes(shipment.operationState) ? <button className="danger-button operational-danger-action" type="button" disabled={busy} onClick={() => void cancel(shipment.id)}>Cancelar</button> : null}
                </div>
              ) : null}
            </div>
          )) : <p className="operational-muted">Remessa ainda não criada.</p>}
        </section>
        <section className="operational-detail-section">
          <h3>Histórico</h3>
          {order.history.length ? (
            <ol className="operational-timeline">
              {order.history.slice(0, 8).map((entry) => (
                <li key={`${entry.createdAt}-${entry.status}`}>
                  <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                  <span><strong>{label(entry.status)}</strong> · {entry.reason}</span>
                </li>
              ))}
            </ol>
          ) : <p className="operational-muted">Sem movimentações.</p>}
        </section>
        <section className="operational-detail-section">
          <h3>Observações</h3>
          {canAddNote ? (
            <form className="operational-note-form" onSubmit={(event) => void note(event)}>
              <label className="operational-field">
                <span>Observação operacional</span>
                <textarea name="note" minLength={3} maxLength={1000} required />
              </label>
              <button className="primary-button" type="submit" disabled={busy}>
                {processing === "add_order_note" ? <LoaderCircle className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />} Registrar
              </button>
            </form>
          ) : null}
          {order.notes.length ? (
            order.notes.map((item) => <p className="operational-note" key={item.id}><time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time> {item.content}</p>)
          ) : <p className="operational-muted">Nenhuma observação registrada.</p>}
        </section>
      </div>
    </PanelDrawer>
  );
}

function TaskList({
  tasks,
  run,
  processing = "",
  compact = false,
  canExecute = false
}: {
  tasks: OperationTask[];
  run?: Run;
  processing?: string;
  compact?: boolean;
  canExecute?: boolean;
}) {
  const [selected, setSelected] = useState("");
  const selectedTask = tasks.find((task) => task.id === selected);
  if (!tasks.length) {
    return <StateMessage compact level={3} icon={ClipboardCheck} title="Nenhuma tarefa nesta fila" description="A fila será atualizada quando houver registros confirmados." />;
  }
  const now = Date.now();
  return (
    <>
      <div className="operational-list">
        {tasks.map((task) => {
          const overdue = Boolean(task.dueAt && task.status !== "completed" && new Date(task.dueAt).getTime() < now);
          const canClaim = canExecute && !task.assigned;
          return (
            <article className="operational-item" key={task.id}>
              <div className="operational-item-main">
                <div className="operational-item-title">
                  <Code>{task.sourceCode || task.publicCode}</Code>
                  <StatusLabel tone={statusTone(task.status)}>{label(task.status)}</StatusLabel>
                  <StatusLabel tone={priorityTone(task.priority)}>{label(task.priority)}</StatusLabel>
                  {overdue ? <StatusLabel tone="danger" icon={AlertTriangle}>Atrasada</StatusLabel> : null}
                </div>
                <p className="operational-item-meta">
                  {label(task.taskType)} · {task.dueAt ? `Prazo ${formatDateTime(task.dueAt)}` : "Sem prazo configurado"}
                  {!compact ? ` · ${task.assignedToCurrentUser ? "Minha tarefa" : task.assigned ? "Atribuída" : "Sem responsável"}` : ""}
                </p>
              </div>
              {!compact && run && (
                <div className="operational-actions">
                  {canClaim && <button className="primary-button" type="button" disabled={Boolean(processing)} onClick={() => void run({ action: "claim_task", taskId: task.id }, "Tarefa assumida.")}>Assumir</button>}
                  <button className={canClaim ? "secondary-button" : "primary-button"} type="button" onClick={() => setSelected(task.id)}>Conferir</button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {selectedTask && run && <TaskDetail task={selectedTask} close={() => setSelected("")} run={run} processing={processing} canExecute={canExecute} />}
    </>
  );
}

function TaskDetail({
  task,
  close,
  run,
  processing,
  canExecute
}: {
  task: OperationTask;
  close: () => void;
  run: Run;
  processing: string;
  canExecute: boolean;
}) {
  const confirm = usePanelConfirm();
  const complete = async () => {
    const accepted = await confirm({
      title: "Concluir conferência?",
      description: "A tarefa será concluída com as quantidades e divergências salvas em cada item.",
      confirmLabel: "Concluir conferência"
    });
    if (accepted) void run({ action: "complete_task", taskId: task.id }, "Tarefa concluída.");
  };
  return (
    <PanelDrawer open title={task.sourceCode || task.publicCode} eyebrow={label(task.taskType)} busy={Boolean(processing)} onClose={close}>
      <div className="operational-detail">
        <div className="operational-item-tags">
          <StatusLabel tone={statusTone(task.status)}>{label(task.status)}</StatusLabel>
          <StatusLabel tone={priorityTone(task.priority)}>{label(task.priority)}</StatusLabel>
        </div>
        {!canExecute ? (
          <p className="admin-feedback info">Seu perfil possui acesso somente para consulta desta tarefa.</p>
        ) : !task.assignedToCurrentUser ? (
          <p className="admin-feedback warning">Assuma a tarefa antes de registrar a conferência.</p>
        ) : (
          <>
            <div className="operational-check-list">
              {task.items.map((item) => <TaskItem item={item} run={run} processing={processing} key={item.id} />)}
            </div>
            <div className="operational-detail-footer">
              <button className="primary-button" type="button" disabled={Boolean(processing)} onClick={() => void complete()}>
                {processing === "complete_task" ? <LoaderCircle className="spin" aria-hidden="true" /> : <Check aria-hidden="true" />} Concluir conferência
              </button>
            </div>
          </>
        )}
      </div>
    </PanelDrawer>
  );
}

function TaskItem({
  item,
  run,
  processing
}: {
  item: OperationItem;
  run: Run;
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
    <form className="operational-check-item" onSubmit={submit}>
      <div className="operational-check-product">
        <strong>{item.productName}</strong>
        <small><Code>{item.sku}</Code>{item.variant ? ` · ${item.variant}` : ""}</small>
      </div>
      <div className="operational-check-expected">
        <span>Esperado</span>
        <strong className="ui-num">{item.expectedQuantity ?? "—"}</strong>
      </div>
      <label className="operational-field">
        <span>Conferido</span>
        <input name="quantity" type="number" inputMode="numeric" min={0} max={999} defaultValue={item.checkedQuantity ?? item.expectedQuantity} required />
      </label>
      <label className="operational-field operational-check-reason">
        <span>Divergência</span>
        <input name="reason" maxLength={500} defaultValue={item.divergenceReason ?? ""} placeholder="Obrigatório se diferente" />
      </label>
      <button className="secondary-button" type="submit" disabled={Boolean(processing)}><Check aria-hidden="true" /> Salvar</button>
    </form>
  );
}

function Inventory({
  section,
  items,
  movements,
  adjustments,
  run,
  processing,
  canRequest
}: {
  section: string;
  items: InventoryItem[];
  movements: OperationsResponse["movements"];
  adjustments: OperationsResponse["adjustments"];
  run: Run;
  processing: string;
  canRequest: boolean;
}) {
  const [adjustmentTarget, setAdjustmentTarget] = useState<InventoryItem | null>(null);
  const request = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!adjustmentTarget) return;
    const form = new FormData(event.currentTarget);
    const quantityDelta = Number(formText(form.get("quantityDelta")));
    const reason = formText(form.get("reason"));
    if (!Number.isInteger(quantityDelta) || quantityDelta === 0 || !reason) return;
    if (
      await run(
        { action: "request_adjustment", variantId: adjustmentTarget.variantId, quantityDelta, reason },
        "Solicitação de ajuste registrada para aprovação."
      )
    ) {
      setAdjustmentTarget(null);
    }
  };
  const emptyTitle = section === "danificados" ? "Nenhum item danificado" : section === "reposicao" ? "Nenhum item abaixo do mínimo" : "Nenhum item encontrado";
  return (
    <>
      <section className="operational-block" aria-label="Itens de estoque">
        <ResultCount count={items.length} singular="variação" plural="variações" />
        {items.length ? (
          <div className="admin-table-wrap operational-table-wrap">
            <table className="data-table ui-table-stack operational-inventory-table">
              <thead>
                <tr>
                  <th scope="col">Produto</th>
                  <th scope="col" className="ui-num">Disponível</th>
                  <th scope="col" className="ui-num">Reservado</th>
                  <th scope="col" className="ui-num">Danificado</th>
                  <th scope="col" className="ui-num">Mínimo</th>
                  <th scope="col">Situação</th>
                  {canRequest ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.variantId}>
                    <td className="operational-product-cell">
                      <strong>{item.productName}</strong>
                      <small><Code>{item.sku}</Code>{item.variant ? ` · ${item.variant}` : ""}</small>
                    </td>
                    <td className="ui-num" data-label="Disponível">{item.available}</td>
                    <td className="ui-num" data-label="Reservado">{item.reserved}</td>
                    <td className="ui-num" data-label="Danificado">{item.damaged}</td>
                    <td className="ui-num" data-label="Mínimo">{item.minimum}</td>
                    <td data-label="Situação">
                      <span className="operational-item-tags">
                        {item.critical ? <StatusLabel tone="danger" icon={AlertTriangle}>Crítico</StatusLabel> : null}
                        {item.damaged > 0 ? <StatusLabel tone="warning">Danificado</StatusLabel> : null}
                        {!item.critical && item.damaged <= 0 ? <span className="operational-muted">Sem alerta</span> : null}
                      </span>
                    </td>
                    {canRequest ? (
                      <td className="operational-cell-actions">
                        <button className="secondary-button" type="button" disabled={Boolean(processing)} onClick={() => setAdjustmentTarget(item)}>Solicitar ajuste</button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <StateMessage compact icon={Boxes} title={emptyTitle} description="A lista será atualizada quando houver registros confirmados." />
        )}
      </section>
      <div className="operational-dashboard-grid">
        <section className="operational-block" aria-labelledby="operational-movements-title">
          <SectionHeader id="operational-movements-title" title="Movimentações recentes" description="Trilha registrada pelo estoque." />
          {movements.length ? (
            <ol className="operational-timeline operational-surface">
              {movements.slice(0, 10).map((item) => (
                <li key={item.id}>
                  <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                  <span>{item.reason}</span>
                  <span className="operational-movement ui-num">
                    <strong data-tone={item.quantity > 0 ? "in" : item.quantity < 0 ? "out" : undefined}>{item.quantity > 0 ? "+" : ""}{item.quantity}</strong>
                    <span>{item.previous} → {item.current}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <StateMessage compact level={3} title="Nenhuma movimentação recente" description="Entradas, saídas e ajustes aplicados aparecem aqui." />
          )}
        </section>
        <section className="operational-block" aria-labelledby="operational-adjustments-title">
          <SectionHeader id="operational-adjustments-title" title="Ajustes solicitados" description="O Operacional não aprova o próprio ajuste." />
          {adjustments.length ? (
            <ul className="operational-records operational-surface">
              {adjustments.map((item) => (
                <li key={item.id}>
                  <Code>{item.publicCode}</Code>
                  <strong className="ui-num">{item.quantityDelta > 0 ? "+" : ""}{item.quantityDelta}</strong>
                  <StatusLabel tone={statusTone(item.status)}>{label(item.status)}</StatusLabel>
                </li>
              ))}
            </ul>
          ) : (
            <StateMessage compact level={3} title="Nenhuma solicitação" description={canRequest ? "Use “Solicitar ajuste” em um item para enviar uma diferença à aprovação." : "As solicitações de ajuste aparecem aqui."} />
          )}
        </section>
      </div>
      {adjustmentTarget ? (
        <OperationalActionDialog
          title="Solicitar ajuste de estoque"
          description={`${adjustmentTarget.productName} · ${adjustmentTarget.sku}`}
          submitLabel="Enviar para aprovação"
          pending={Boolean(processing)}
          onClose={() => setAdjustmentTarget(null)}
          onSubmit={(event) => void request(event)}
        >
          <label className="operational-field">
            <span>Diferença de quantidade <RequiredMark /></span>
            <input
              name="quantityDelta"
              type="number"
              inputMode="numeric"
              step="1"
              required
              autoFocus
              placeholder="Ex.: 3 ou -2"
              aria-describedby="operational-adjustment-help"
              onInput={(event) => event.currentTarget.setCustomValidity(event.currentTarget.value === "0" ? "Informe uma diferença diferente de zero." : "")}
            />
            <small id="operational-adjustment-help">Use valor positivo para entrada e negativo para saída.</small>
          </label>
          <label className="operational-field">
            <span>Motivo detalhado <RequiredMark /></span>
            <textarea name="reason" minLength={5} maxLength={500} required placeholder="Explique a origem do ajuste solicitado." />
          </label>
        </OperationalActionDialog>
      ) : null}
    </>
  );
}

function Kits({
  kits,
  run,
  processing,
  canExecute
}: {
  kits: KitOrder[];
  run: Run;
  processing: string;
  canExecute: boolean;
}) {
  return (
    <section className="operational-block" aria-label="Kits de representantes">
      <ResultCount count={kits.length} singular="kit" plural="kits" />
      {kits.length ? (
        <div className="operational-list">
          {kits.map((kit) => {
            const itemCount = kit.items.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
            return (
              <article className="operational-item" key={kit.id}>
                <div className="operational-item-main">
                  <div className="operational-item-title">
                    <Code>{kit.publicCode}</Code>
                    <StatusLabel tone={statusTone(kit.status)}>{label(kit.status)}</StatusLabel>
                  </div>
                  <p className="operational-item-meta">
                    {kit.kitName} · Representante <Code>{kit.representativeCode}</Code> · <span className="ui-num">{itemCount}</span> {itemCount === 1 ? "item" : "itens"} · {formatDateTime(kit.createdAt)}
                  </p>
                </div>
                <div className="operational-actions">
                  {canExecute && ["paid", "separating"].includes(kit.status) && (
                    <button className="primary-button" type="button" disabled={Boolean(processing)} onClick={() => void run({ action: "start_kit", kitOrderId: kit.id }, "Montagem do kit iniciada.")}>
                      {processing === "start_kit" ? <LoaderCircle className="spin" aria-hidden="true" /> : <PackageCheck aria-hidden="true" />} Montar
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <StateMessage compact icon={PackageCheck} title="Nenhum kit pendente" description="Kits pagos de representantes aparecem aqui para montagem." />
      )}
    </section>
  );
}

function Returns({
  records,
  run,
  processing,
  canInspect
}: {
  records: ReturnRecord[];
  run: Run;
  processing: string;
  canInspect: boolean;
}) {
  const [inspectionTarget, setInspectionTarget] = useState<ReturnRecord["items"][number] | null>(null);
  const inspect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!inspectionTarget) return;
    const form = new FormData(event.currentTarget);
    const condition = formText(form.get("condition"));
    const destination = formText(form.get("destination"));
    const result = formText(form.get("result"));
    if (!condition || !result || !["sellable", "damaged", "discard", "supplier"].includes(destination)) return;
    if (await run({ action: "inspect_return", returnItemId: inspectionTarget.id, condition, destination, result }, "Inspeção registrada.")) {
      setInspectionTarget(null);
    }
  };
  return (
    <section className="operational-block" aria-label="Solicitações de troca e devolução">
      <ResultCount count={records.length} singular="solicitação" plural="solicitações" />
      {records.length ? (
        <div className="operational-return-grid">
          {records.map((record) => (
            <article className="operational-return" key={record.id}>
              <header>
                <div>
                  <Code>{record.publicCode}</Code>
                  <small>Pedido <Code>{record.orderCode}</Code> · {formatDate(record.requestedAt)}</small>
                </div>
                <StatusLabel tone={statusTone(record.status)}>{label(record.status)}</StatusLabel>
              </header>
              <dl className="operational-return-facts">
                <div><dt>Solicitação</dt><dd>{label(record.requestedResolution)}</dd></div>
                <div><dt>Motivo</dt><dd>{record.reason}</dd></div>
              </dl>
              {record.description ? <p className="operational-return-description">{record.description}</p> : null}
              <ul className="operational-return-items">
                {record.items.map((item) => (
                  <li key={item.id}>
                    <span>
                      <strong><span className="ui-num">{item.quantity}×</span> {item.productName}</strong>
                      <small><Code>{item.sku}</Code>{item.condition ? ` · ${item.condition}` : ""}</small>
                      {item.condition ? null : <StatusLabel tone="warning">Aguardando inspeção</StatusLabel>}
                    </span>
                    {canInspect && ["received", "inspection"].includes(record.status) && (
                      <button className="primary-button" type="button" disabled={Boolean(processing)} onClick={() => setInspectionTarget(item)}>Inspecionar</button>
                    )}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : (
        <StateMessage compact icon={RotateCcw} title="Nenhuma solicitação nesta fila" description="Solicitações recebidas para inspeção física aparecem aqui." />
      )}
      {inspectionTarget ? (
        <OperationalActionDialog
          title="Registrar inspeção"
          description={`${inspectionTarget.productName} · ${inspectionTarget.sku}`}
          submitLabel="Salvar inspeção"
          pending={Boolean(processing)}
          onClose={() => setInspectionTarget(null)}
          onSubmit={(event) => void inspect(event)}
        >
          <label className="operational-field">
            <span>Condição física <RequiredMark /></span>
            <input name="condition" minLength={3} maxLength={300} required autoFocus placeholder="Descreva o estado recebido." />
          </label>
          <label className="operational-field">
            <span>Destino do item <RequiredMark /></span>
            <select name="destination" defaultValue="damaged" required>
              <option value="sellable">Retornar ao estoque disponível</option>
              <option value="damaged">Estoque danificado</option>
              <option value="discard">Descarte</option>
              <option value="supplier">Devolver ao fornecedor</option>
            </select>
          </label>
          <label className="operational-field">
            <span>Resultado da conferência <RequiredMark /></span>
            <textarea name="result" minLength={5} maxLength={1000} required placeholder="Registre o resultado e as evidências da inspeção." />
          </label>
        </OperationalActionDialog>
      ) : null}
    </section>
  );
}

function Occurrences({
  occurrences,
  run,
  processing,
  canCreate,
  canResolve
}: {
  occurrences: Occurrence[];
  run: Run;
  processing: string;
  canCreate: boolean;
  canResolve: boolean;
}) {
  const [resolutionTarget, setResolutionTarget] = useState<Occurrence | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = Object.fromEntries(form);
    if (await run({ action: "create_occurrence", ...payload }, "Ocorrência registrada.")) {
      formElement.reset();
    }
  };
  const resolve = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resolutionTarget) return;
    const resolution = formText(new FormData(event.currentTarget).get("resolution"));
    if (!resolution) return;
    if (await run({ action: "resolve_occurrence", occurrenceId: resolutionTarget.id, resolution, resolutionStatus: "resolved" }, "Ocorrência resolvida.")) {
      setResolutionTarget(null);
    }
  };
  return (
    <div className={`operational-occurrence-layout${canCreate ? "" : " single"}`}>
      {canCreate ? (
        <section className="operational-block" aria-labelledby="operational-new-occurrence-title">
          <SectionHeader id="operational-new-occurrence-title" title="Nova ocorrência" description="Registre somente dados necessários à operação." />
          <form className="panel-card operational-occurrence-form" onSubmit={(event) => void submit(event)}>
            <label className="operational-field">
              <span>Categoria <RequiredMark /></span>
              <select name="category" required defaultValue="divergence"><option value="divergence">Divergência</option><option value="damaged_product">Produto danificado</option><option value="missing_item">Item ausente</option><option value="shipping">Envio</option><option value="invoice">Nota fiscal</option><option value="return">Devolução</option><option value="exchange">Troca</option><option value="kit">Kit</option><option value="inventory">Estoque</option><option value="customer_service">Atendimento</option><option value="other">Outra</option></select>
            </label>
            <label className="operational-field">
              <span>Prioridade</span>
              <select name="priority" defaultValue="normal"><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select>
            </label>
            <label className="operational-field">
              <span>Título <RequiredMark /></span>
              <input name="title" minLength={5} maxLength={120} required aria-describedby="operational-occurrence-title-help" />
              <small id="operational-occurrence-title-help">De 5 a 120 caracteres.</small>
            </label>
            <label className="operational-field">
              <span>Descrição <RequiredMark /></span>
              <textarea name="description" minLength={5} maxLength={2000} required />
            </label>
            <button className="primary-button" type="submit" disabled={Boolean(processing)}>
              {processing === "create_occurrence" ? <LoaderCircle className="spin" aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />} Registrar
            </button>
          </form>
        </section>
      ) : null}
      <section className="operational-block" aria-labelledby="operational-occurrence-history-title">
        <SectionHeader
          id="operational-occurrence-history-title"
          title="Histórico de ocorrências"
          description="Fila por prioridade e status."
          actions={<CountLabel count={occurrences.length} />}
        />
        <OccurrenceList occurrences={occurrences} resolve={canResolve ? setResolutionTarget : undefined} />
      </section>
      {resolutionTarget ? (
        <OperationalActionDialog
          title="Resolver ocorrência"
          description={`${resolutionTarget.publicCode} · ${resolutionTarget.title}`}
          submitLabel="Confirmar resolução"
          pending={Boolean(processing)}
          onClose={() => setResolutionTarget(null)}
          onSubmit={(event) => void resolve(event)}
        >
          <label className="operational-field">
            <span>Resolução aplicada <RequiredMark /></span>
            <textarea name="resolution" minLength={5} maxLength={2000} required autoFocus placeholder="Descreva o que foi feito e o resultado obtido." />
          </label>
        </OperationalActionDialog>
      ) : null}
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
  if (!occurrences.length) {
    return <StateMessage compact level={3} icon={ShieldAlert} title="Nenhuma ocorrência aberta" description="Divergências registradas pela operação aparecem aqui." />;
  }
  return (
    <div className="operational-list">
      {occurrences.map((item) => (
        <article className="operational-item" key={item.id}>
          <div className="operational-item-main">
            <div className="operational-item-title">
              <Code>{item.publicCode}</Code>
              <StatusLabel tone={priorityTone(item.priority)}>{label(item.priority)}</StatusLabel>
              <StatusLabel tone={statusTone(item.status)}>{label(item.status)}</StatusLabel>
            </div>
            <strong className="operational-item-name">{item.title}</strong>
            <p className="operational-item-meta">{label(item.category)} · {formatDateTime(item.createdAt)}</p>
            {!compact && <p className="operational-item-description">{item.description}</p>}
          </div>
          {resolve && !["resolved", "rejected"].includes(item.status) && (
            <div className="operational-actions">
              <button className="secondary-button" type="button" onClick={() => resolve(item)}>Resolver</button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function Invoices({ invoices }: { invoices: OperationsResponse["invoices"] }) {
  return (
    <section className="operational-block" aria-label="Notas fiscais">
      <ResultCount count={invoices.length} singular="documento" plural="documentos" />
      {invoices.length ? (
        <div className="admin-table-wrap operational-table-wrap">
          <table className="data-table ui-table-stack">
            <thead>
              <tr>
                <th scope="col">Pedido</th>
                <th scope="col">Tipo</th>
                <th scope="col">Status</th>
                <th scope="col">Referência</th>
                <th scope="col" className="ui-num">Tentativas</th>
                <th scope="col">Atenção</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="operational-product-cell">
                    <strong>{invoice.orderCode ? <Code>{invoice.orderCode}</Code> : "Pedido"}</strong>
                    <small>{formatDateTime(invoice.createdAt)}</small>
                  </td>
                  <td data-label="Tipo">{label(invoice.type)}</td>
                  <td data-label="Status"><StatusLabel tone={statusTone(invoice.status)}>{label(invoice.status)}</StatusLabel></td>
                  <td data-label="Referência">{invoice.reference ? <Code>{invoice.reference}</Code> : <span className="operational-muted">Sem referência</span>}</td>
                  <td className="ui-num" data-label="Tentativas">{invoice.attempts}</td>
                  <td data-label="Atenção">{invoice.error ? <StatusLabel tone="danger" icon={AlertTriangle}>Exige atenção</StatusLabel> : <span className="operational-muted">Nenhuma</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <StateMessage compact icon={FileText} title="Nenhum documento fiscal" description="Notas emitidas para os pedidos aparecem aqui." />
      )}
    </section>
  );
}

function Representatives({ representatives }: { representatives: OperationsResponse["representatives"] }) {
  return (
    <section className="operational-block" aria-label="Representantes">
      <SectionHeader title="Representantes" description="Visão operacional mínima para kits e ocorrências; níveis e comissões não são expostos." />
      {representatives.length ? (
        <div className="operational-list">
          {representatives.map((item) => (
            <article className="operational-item" key={item.id}>
              <div className="operational-item-main">
                <div className="operational-item-title">
                  <Code>{item.publicCode}</Code>
                  <StatusLabel tone={statusTone(item.status)}>{label(item.status)}</StatusLabel>
                </div>
                <p className="operational-item-meta">Região {item.regionCode ?? "não informada"} · Desde {formatDate(item.createdAt)}</p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <StateMessage compact icon={UserRound} title="Nenhum representante encontrado" description="A lista será atualizada quando houver registros confirmados." />
      )}
    </section>
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
    <section className="operational-block" aria-label="Relatório operacional">
      <div className="admin-table-wrap operational-table-wrap">
        <table className="data-table">
          <caption className="sr-only">Contagens atuais das filas operacionais</caption>
          <thead>
            <tr>
              <th scope="col">Fila</th>
              <th scope="col" className="ui-num">Quantidade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, value]) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="ui-num">{formatCount(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
  const first = (pagination.page - 1) * pagination.pageSize + 1;
  const last = Math.min(pagination.page * pagination.pageSize, pagination.total);
  return (
    <nav className="operational-pagination" aria-label="Paginação">
      <span className="ui-num">{formatCount(first)}–{formatCount(last)} de {formatCount(pagination.total)} · Página {pagination.page} de {pages}</span>
      <div>
        <button className="secondary-button" type="button" disabled={pagination.page <= 1} onClick={() => changePage(pagination.page - 1)}><ChevronLeft aria-hidden="true" /> Anterior</button>
        <button className="secondary-button" type="button" disabled={pagination.page >= pages} onClick={() => changePage(pagination.page + 1)}>Próxima <ChevronRight aria-hidden="true" /></button>
      </div>
    </nav>
  );
}

function OperationalActionDialog({
  title,
  description,
  submitLabel,
  pending,
  onClose,
  onSubmit,
  children
}: {
  title: string;
  description: string;
  submitLabel: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const pendingRef = useRef(pending);

  useEffect(() => {
    onCloseRef.current = onClose;
    pendingRef.current = pending;
  }, [onClose, pending]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const keepFocusInside = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !pendingRef.current) {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", keepFocusInside);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keepFocusInside);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div
      className="admin-modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !pending) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="admin-modal compact operational-action-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="operational-dialog-title"
        aria-describedby="operational-dialog-description"
      >
        <header>
          <div>
            <span>Ação operacional auditável</span>
            <h2 id="operational-dialog-title">{title}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={pending} aria-label="Fechar formulário" title="Fechar formulário">
            <X aria-hidden="true" />
          </button>
        </header>
        <form onSubmit={onSubmit}>
          <p id="operational-dialog-description">{description}</p>
          <div className="operational-dialog-fields">{children}</div>
          <footer>
            <button className="secondary-button" type="button" onClick={onClose} disabled={pending}>
              Cancelar
            </button>
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
              {pending ? "Processando" : submitLabel}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function RequiredMark() {
  return <span className="operational-required" aria-hidden="true">*</span>;
}
function CountLabel({ count }: { count: number }) {
  return <span className="operational-count-label ui-num">{formatCount(count)}</span>;
}
function ResultCount({ count, singular, plural }: { count: number; singular: string; plural: string }) {
  return <p className="operational-count" aria-live="polite"><span className="ui-num">{formatCount(count)}</span> {count === 1 ? singular : plural}</p>;
}
function OperationalLoading({ dashboard }: { dashboard: boolean }) {
  return (
    <div className="operational-loading" role="status" aria-live="polite" aria-busy="true" aria-label="Carregando operação">
      <span className="sr-only">Carregando operação</span>
      {dashboard ? (
        <div className="operational-loading-kpis" aria-hidden="true">
          <span className="ui-skeleton" /><span className="ui-skeleton" /><span className="ui-skeleton" /><span className="ui-skeleton" />
        </div>
      ) : (
        <span className="ui-skeleton operational-loading-toolbar" aria-hidden="true" />
      )}
      <div className="operational-loading-rows" aria-hidden="true">
        <span className="ui-skeleton" /><span className="ui-skeleton" /><span className="ui-skeleton" /><span className="ui-skeleton" />
      </div>
    </div>
  );
}

const formText = (value: FormDataEntryValue | null) => typeof value === "string" ? value.trim() : "";
const formatCurrency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const formatCount = (value: number) => value.toLocaleString("pt-BR");

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
    refund_pending: "Cancelamento: reembolso em processamento",
    cancellation_requested: "Cancelamento: pagamento em verificação",
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
/** Tom da etiqueta de status. O mesmo significado usa o mesmo tom em todo o painel. */
const statusTone = (value: string): UiTone => {
  if (["completed", "delivered", "resolved", "approved", "applied", "active", "paid"].includes(value)) return "success";
  if (["blocked", "rejected", "suspended"].includes(value)) return "danger";
  if (["manual_review", "refund_pending", "cancellation_requested", "pending_payment", "requested", "received", "open"].includes(value)) return "warning";
  if (["in_progress", "processing", "picking", "ready_to_ship", "shipped", "separating", "inspection", "in_review"].includes(value)) return "info";
  return "neutral";
};
/** Prioridade: vermelho só para o que é crítico (urgente). */
const priorityTone = (value: string): UiTone => (value === "urgent" ? "danger" : value === "high" ? "warning" : "neutral");
