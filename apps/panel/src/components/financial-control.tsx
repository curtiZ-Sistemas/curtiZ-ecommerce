"use client";

import {
  ArrowDownCircle,
  ArrowUpCircle,
  BadgeDollarSign,
  CalendarDays,
  Download,
  FileClock,
  Landmark,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  Users,
  WalletCards,
  X
} from "lucide-react";
import {
  type FocusEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  addDays,
  centsToMoneyInput,
  emptyFinancialSnapshot,
  isFinancialSnapshot,
  moneyToCents,
  splitInstallments,
  type FinancialExportScope,
  type FinancialRecord,
  type FinancialSnapshot
} from "@/lib/financial-control";
import { exportFinancialWorkbook } from "@/lib/financial-export";
import { usePanelPrompt } from "./panel-prompt";

type Tab =
  | "dashboard"
  | "receivables"
  | "payables"
  | "transactions"
  | "contributions"
  | "settings"
  | "audit";
type Ledger = "receivable" | "payable";
type ModalState =
  | { kind: "ledger"; ledger: Ledger; item?: FinancialRecord }
  | { kind: "settle"; ledger: Ledger; item: FinancialRecord }
  | { kind: "transaction"; item?: FinancialRecord }
  | { kind: "contribution"; item?: FinancialRecord }
  | { kind: "account"; item?: FinancialRecord }
  | { kind: "category"; item?: FinancialRecord }
  | { kind: "group"; item?: FinancialRecord }
  | { kind: "partner"; item?: FinancialRecord };

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const shortDate = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeZone: "America/Sao_Paulo"
});
const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});
const chartColors = ["#982920", "#d36a43", "#2d9c78", "#c94336", "#5271c4"];

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "dashboard", label: "Visão geral" },
  { id: "receivables", label: "A receber" },
  { id: "payables", label: "A pagar" },
  { id: "transactions", label: "Lançamentos" },
  { id: "contributions", label: "Aportes" },
  { id: "settings", label: "Configurações" },
  { id: "audit", label: "Histórico" }
];

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function periodFor(preset: string) {
  const end = today();
  const now = new Date(`${end}T12:00:00Z`);
  const from = new Date(now);
  if (preset === "today") return { from: end, to: end };
  if (preset === "7days") from.setUTCDate(from.getUTCDate() - 6);
  if (preset === "month") from.setUTCDate(1);
  if (preset === "previous") {
    from.setUTCMonth(from.getUTCMonth() - 1, 1);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  if (preset === "year") from.setUTCMonth(0, 1);
  return { from: from.toISOString().slice(0, 10), to: end };
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMoneyField(event: FocusEvent<HTMLInputElement>) {
  const cents = moneyToCents(event.currentTarget.value);
  if (cents !== null) event.currentTarget.value = centsToMoneyInput(cents);
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true";
}

function formattedDate(value: unknown, withTime = false) {
  if (typeof value !== "string" || !value) return "—";
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00-03:00` : value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : withTime
      ? dateTime.format(parsed)
      : shortDate.format(parsed);
}

function recordLabel(item: FinancialRecord, ...keys: string[]) {
  return keys.map((key) => scalar(item[key])).find(Boolean) ?? "—";
}

function statusLabel(status: string, ledger?: Ledger) {
  const labels: Record<string, string> = {
    pending: "Pendente",
    overdue: "Vencido",
    received: "Recebido",
    paid: "Pago",
    cancelled: "Cancelado"
  };
  return labels[status] ?? (ledger === "receivable" ? "A receber" : "A pagar");
}

function chartMoney(value: unknown) {
  return currency.format(numberValue(value));
}

export function FinancialControl() {
  const requestPrompt = usePanelPrompt();
  const initial = periodFor("month");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [preset, setPreset] = useState("month");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [data, setData] = useState<FinancialSnapshot>(emptyFinancialSnapshot);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [canExport, setCanExport] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [demo, setDemo] = useState(false);
  const closeModal = useCallback(() => setModal(null), []);

  const load = useCallback(
    async (quiet = false) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
        setError("Revise o período selecionado.");
        setLoading(false);
        return;
      }
      if (!quiet) setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ from, to });
        const response = await fetch(`/api/manager/finance?${params}`, { cache: "no-store" });
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object" || Array.isArray(payload))
          throw new Error("invalid response");
        const result = payload as Record<string, unknown>;
        if (!response.ok) throw new Error(scalar(result.message) || "load failed");
        if (result.demo === true) {
          setDemo(true);
          setData(emptyFinancialSnapshot);
        } else if (isFinancialSnapshot(result.data)) {
          setDemo(false);
          setData(result.data);
        } else {
          throw new Error("invalid data");
        }
        setCanExport(result.canExport === true);
        setUpdatedAt(new Date());
      } catch (loadError) {
        setError(
          loadError instanceof Error && loadError.message !== "load failed"
            ? loadError.message
            : "Não foi possível carregar o controle financeiro."
        );
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [from, to]
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const mutate = async (action: string, payload: Record<string, unknown>, success: string) => {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/manager/finance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, payload })
      });
      const result: unknown = await response.json();
      const record =
        result && typeof result === "object" && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : {};
      if (!response.ok)
        throw new Error(scalar(record.message) || "Não foi possível concluir a operação.");
      setModal(null);
      setMessage(success);
      await load(true);
      return true;
    } catch (mutationError) {
      setMessage(
        mutationError instanceof Error
          ? mutationError.message
          : "Não foi possível concluir a operação."
      );
      return false;
    } finally {
      setPending(false);
    }
  };

  const changePreset = (value: string) => {
    setPreset(value);
    if (value !== "custom") {
      const period = periodFor(value);
      setFrom(period.from);
      setTo(period.to);
    }
  };

  const exportWorkbook = async (scope: FinancialExportScope) => {
    setExportOpen(false);
    const logged = await mutate(
      "export.log",
      { scope, from, to },
      "Excel exportado e registrado no histórico."
    );
    if (!logged) return;
    setPending(true);
    try {
      await exportFinancialWorkbook(data, scope, { from, to });
    } catch {
      setMessage("Não foi possível montar o arquivo Excel neste dispositivo.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="financial-control" aria-busy={loading || pending}>
      <header className="financial-header">
        <div>
          <span className="page-heading-eyebrow">Painel dos sócios</span>
          <h1>Controle financeiro</h1>
          <p>Caixa, compromissos e aportes conectados em uma única fonte de verdade.</p>
        </div>
        <div className="financial-header-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => void load()}
            disabled={loading || pending}
          >
            <RefreshCw className={loading ? "spin" : ""} aria-hidden="true" /> Sincronizar
          </button>
          <div className="financial-export">
            <button
              className="primary-button"
              type="button"
              onClick={() => setExportOpen((open) => !open)}
              disabled={!canExport || pending || demo}
              aria-expanded={exportOpen}
            >
              <Download aria-hidden="true" /> Exportar para Excel
            </button>
            {exportOpen ? (
              <div className="financial-export-menu">
                {(["all", "receivables", "payables", "transactions", "contributions"] as const).map(
                  (scope) => (
                    <button key={scope} type="button" onClick={() => void exportWorkbook(scope)}>
                      {
                        {
                          all: "Arquivo completo",
                          receivables: "Contas a receber",
                          payables: "Contas a pagar",
                          transactions: "Lançamentos",
                          contributions: "Aportes"
                        }[scope]
                      }
                    </button>
                  )
                )}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="financial-period panel-card">
        <label>
          <span>Período</span>
          <select value={preset} onChange={(event) => changePreset(event.target.value)}>
            <option value="today">Hoje</option>
            <option value="7days">7 dias</option>
            <option value="month">Este mês</option>
            <option value="previous">Mês anterior</option>
            <option value="year">Este ano</option>
            <option value="custom">Personalizado</option>
          </select>
        </label>
        {preset === "custom" ? (
          <>
            <label>
              <span>De</span>
              <input
                type="date"
                value={from}
                max={to}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label>
              <span>Até</span>
              <input
                type="date"
                value={to}
                min={from}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
          </>
        ) : null}
        <small>
          {updatedAt
            ? `Sincronizado às ${updatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
            : "Aguardando sincronização"}
        </small>
      </div>

      <nav className="financial-tabs" aria-label="Áreas do financeiro">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "active" : ""}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {message ? (
        <p className="financial-feedback" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <div className="admin-empty-state" role="alert">
          <h2>Financeiro indisponível</h2>
          <p>{error}</p>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            Tentar novamente
          </button>
        </div>
      ) : loading ? (
        <div className="financial-loading">
          <LoaderCircle className="spin" aria-hidden="true" /> Consolidando dados financeiros…
        </div>
      ) : demo ? (
        <div className="admin-empty-state">
          <h2>Visualização financeira desativada no modo demonstração</h2>
          <p>Entre com um sócio autorizado para consultar ou alterar dados reais.</p>
        </div>
      ) : (
        <>
          {tab === "dashboard" ? <FinancialDashboard data={data} /> : null}
          {tab === "receivables" ? (
            <LedgerSection
              ledger="receivable"
              items={data.receivables}
              onCreate={() => setModal({ kind: "ledger", ledger: "receivable" })}
              onEdit={(item) => setModal({ kind: "ledger", ledger: "receivable", item })}
              onSettle={(item) => setModal({ kind: "settle", ledger: "receivable", item })}
              onReverse={(item) => {
                void (async () => {
                  const reason = await requestPrompt({
                    title: "Estornar recebimento",
                    label: "Motivo do estorno",
                    minLength: 3
                  });
                  if (reason)
                    await mutate(
                      "receivable.reverse",
                      { id: item.id, reason },
                      "Recebimento estornado e caixa atualizado."
                    );
                })();
              }}
              onDelete={(item) => {
                void (async () => {
                  if (
                    window.confirm(
                      "Excluir esta conta pendente? Esta ação ficará registrada no histórico."
                    )
                  )
                    await mutate("receivable.delete", { id: item.id }, "Conta a receber excluída.");
                })();
              }}
            />
          ) : null}
          {tab === "payables" ? (
            <LedgerSection
              ledger="payable"
              items={data.payables}
              onCreate={() => setModal({ kind: "ledger", ledger: "payable" })}
              onEdit={(item) => setModal({ kind: "ledger", ledger: "payable", item })}
              onSettle={(item) => setModal({ kind: "settle", ledger: "payable", item })}
              onReverse={(item) => {
                void (async () => {
                  const reason = await requestPrompt({
                    title: "Estornar pagamento",
                    label: "Motivo do estorno",
                    minLength: 3
                  });
                  if (reason)
                    await mutate(
                      "payable.reverse",
                      { id: item.id, reason },
                      "Pagamento estornado e caixa atualizado."
                    );
                })();
              }}
              onDelete={(item) => {
                void (async () => {
                  if (
                    window.confirm(
                      "Excluir esta conta pendente? Esta ação ficará registrada no histórico."
                    )
                  )
                    await mutate("payable.delete", { id: item.id }, "Conta a pagar excluída.");
                })();
              }}
            />
          ) : null}
          {tab === "transactions" ? (
            <TransactionsSection
              data={data}
              onCreate={() => setModal({ kind: "transaction" })}
              onEdit={(item) => setModal({ kind: "transaction", item })}
              onDelete={(item) => {
                void (async () => {
                  if (window.confirm("Estornar este lançamento manual?"))
                    await mutate(
                      "transaction.delete",
                      { id: item.id, reason: "Exclusão confirmada pelo usuário" },
                      "Lançamento manual estornado."
                    );
                })();
              }}
            />
          ) : null}
          {tab === "contributions" ? (
            <ContributionsSection
              data={data}
              onCreate={() => setModal({ kind: "contribution" })}
              onEdit={(item) => setModal({ kind: "contribution", item })}
            />
          ) : null}
          {tab === "settings" ? (
            <SettingsSection data={data} open={setModal} mutate={mutate} />
          ) : null}
          {tab === "audit" ? <AuditSection items={data.audit} /> : null}
        </>
      )}

      {modal ? (
        <FinancialModal
          modal={modal}
          data={data}
          pending={pending}
          close={closeModal}
          mutate={mutate}
        />
      ) : null}
    </section>
  );
}

function FinancialDashboard({ data }: { data: FinancialSnapshot }) {
  const summary = data.summary;
  const cards = [
    ["Saldo atual", summary.balance, WalletCards],
    ["Entradas realizadas", summary.income, ArrowUpCircle],
    ["Saídas realizadas", summary.expense, ArrowDownCircle],
    ["Total a receber", summary.receivable, BadgeDollarSign],
    ["Total a pagar", summary.payable, FileClock],
    ["Saldo projetado", summary.projected_balance, Landmark],
    ["Vencido a receber", summary.overdue_receivable, CalendarDays],
    ["Vencido a pagar", summary.overdue_payable, CalendarDays],
    ["Entradas do mês", summary.month_income, ArrowUpCircle],
    ["Saídas do mês", summary.month_expense, ArrowDownCircle]
  ] as const;
  return (
    <div className="financial-dashboard">
      <div className="financial-metrics">
        {cards.map(([label, value, Icon], index) => (
          <article key={label} className={index === 0 || index === 5 ? "primary" : ""}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
            <strong>{currency.format(value)}</strong>
          </article>
        ))}
      </div>
      {data.series.length === 0 ? (
        <div className="admin-empty-state">
          <h2>Sem movimentação no período</h2>
          <p>
            Cadastre contas, lançamentos ou aportes. Os indicadores serão atualizados
            automaticamente.
          </p>
        </div>
      ) : (
        <div className="financial-charts">
          <ChartCard title="Entradas x saídas">
            <ResponsiveContainer width="100%" height={270}>
              <BarChart data={data.series}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(value) => scalar(value).slice(5)} />
                <YAxis
                  width={72}
                  tickFormatter={(value) => `${Math.round(numberValue(value) / 1000)}k`}
                />
                <Tooltip formatter={chartMoney} />
                <Legend />
                <Bar dataKey="income" name="Entradas" fill="#2d9c78" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" name="Saídas" fill="#d94c68" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Evolução do saldo">
            <ResponsiveContainer width="100%" height={270}>
              <AreaChart data={data.series}>
                <defs>
                  <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#982920" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#982920" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(value) => scalar(value).slice(5)} />
                <YAxis
                  width={72}
                  tickFormatter={(value) => `${Math.round(numberValue(value) / 1000)}k`}
                />
                <Tooltip formatter={chartMoney} />
                <Area
                  type="monotone"
                  dataKey="balance"
                  name="Saldo"
                  stroke="#982920"
                  fill="url(#balanceFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
          <SimpleBarChart
            title="A pagar por categoria"
            data={data.payable_by_category}
            color="#d94c68"
          />
          <SimpleBarChart
            title="A receber por categoria"
            data={data.receivable_by_category}
            color="#2d9c78"
          />
          <SimpleBarChart title="Maiores despesas" data={data.largest_expenses} color="#ff6b35" />
          <SimpleBarChart
            title="Maiores clientes / valores"
            data={data.largest_receivables}
            color="#5271c4"
          />
          <ChartCard title="Situação das contas">
            <ResponsiveContainer width="100%" height={270}>
              <PieChart>
                <Pie
                  data={data.account_status}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {data.account_status.map((item, index) => (
                    <Cell key={item.name} fill={chartColors[index % chartColors.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Aportes por grupo">
            <ResponsiveContainer width="100%" height={270}>
              <BarChart data={data.contribution_groups} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={(value) => `${Math.round(numberValue(value) / 1000)}k`}
                />
                <YAxis type="category" dataKey="name" width={100} />
                <Tooltip formatter={chartMoney} />
                <Legend />
                <Bar dataKey="ideal" name="Ideal" fill="#dfc3c0" />
                <Bar dataKey="realized" name="Realizado" fill="#982920" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="panel-card financial-chart">
      <h2>{title}</h2>
      {children}
    </article>
  );
}
function SimpleBarChart({
  title,
  data,
  color
}: {
  title: string;
  data: Array<{ name: string; value: number }>;
  color: string;
}) {
  return (
    <ChartCard title={title}>
      {data.length ? (
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={data} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(value) => `${Math.round(numberValue(value) / 1000)}k`}
            />
            <YAxis type="category" dataKey="name" width={110} />
            <Tooltip formatter={chartMoney} />
            <Bar dataKey="value" name="Valor" fill={color} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="financial-chart-empty">Sem dados neste recorte.</p>
      )}
    </ChartCard>
  );
}

function LedgerSection({
  ledger,
  items,
  onCreate,
  onEdit,
  onSettle,
  onReverse,
  onDelete
}: {
  ledger: Ledger;
  items: FinancialRecord[];
  onCreate: () => void;
  onEdit: (item: FinancialRecord) => void;
  onSettle: (item: FinancialRecord) => void;
  onReverse: (item: FinancialRecord) => void;
  onDelete: (item: FinancialRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [order, setOrder] = useState("due");
  const [page, setPage] = useState(1);
  const partyKey = ledger === "receivable" ? "customer" : "supplier";
  const filtered = useMemo(
    () =>
      items
        .filter((item) => {
          const searchable =
            `${scalar(item[partyKey])} ${scalar(item.description)} ${scalar(item.document_number)}`.toLocaleLowerCase(
              "pt-BR"
            );
          return (
            (!query || searchable.includes(query.toLocaleLowerCase("pt-BR"))) &&
            (!status || scalar(item.display_status) === status)
          );
        })
        .sort((a, b) =>
          order === "amount"
            ? numberValue(b.amount) - numberValue(a.amount)
            : scalar(a.due_on).localeCompare(scalar(b.due_on))
        ),
    [items, order, partyKey, query, status]
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const visible = filtered.slice((page - 1) * 20, page * 20);
  useEffect(() => setPage(1), [query, status, order]);
  return (
    <section className="panel-card financial-list-section">
      <div className="financial-section-heading">
        <div>
          <h2>{ledger === "receivable" ? "Contas a receber" : "Contas a pagar"}</h2>
          <p>{filtered.length} registro(s) encontrado(s)</p>
        </div>
        <button className="primary-button" type="button" onClick={onCreate}>
          <Plus />
          Nova conta
        </button>
      </div>
      <div className="financial-list-filters">
        <label className="financial-search">
          <Search />
          <input
            aria-label="Pesquisar"
            placeholder="Pesquisar descrição, documento ou nome"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="Filtrar status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">Todos os status</option>
          <option value="pending">Pendentes</option>
          <option value="overdue">Vencidas</option>
          <option value={ledger === "receivable" ? "received" : "paid"}>
            {ledger === "receivable" ? "Recebidas" : "Pagas"}
          </option>
        </select>
        <select
          aria-label="Ordenar"
          value={order}
          onChange={(event) => setOrder(event.target.value)}
        >
          <option value="due">Vencimento</option>
          <option value="amount">Maior valor</option>
        </select>
      </div>
      {visible.length === 0 ? (
        <div className="admin-empty-state">
          <h3>Nenhuma conta encontrada</h3>
          <p>Altere os filtros ou cadastre o primeiro compromisso.</p>
        </div>
      ) : (
        <div className="financial-table-wrap">
          <table className="financial-table">
            <thead>
              <tr>
                <th>{ledger === "receivable" ? "Cliente" : "Fornecedor"}</th>
                <th>Descrição</th>
                <th>Vencimento</th>
                <th>Parcela</th>
                <th>Valor</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const itemStatus = scalar(item.display_status);
                const settled = itemStatus === "received" || itemStatus === "paid";
                return (
                  <tr key={item.id}>
                    <td data-label={ledger === "receivable" ? "Cliente" : "Fornecedor"}>
                      <strong>{recordLabel(item, partyKey)}</strong>
                      <small>{recordLabel(item, "document_number")}</small>
                    </td>
                    <td data-label="Descrição">
                      {recordLabel(item, "description")}
                      <small>{recordLabel(item, "category_name")}</small>
                    </td>
                    <td data-label="Vencimento">{formattedDate(item.due_on)}</td>
                    <td data-label="Parcela">
                      {scalar(item.installment_number)}/{scalar(item.installment_count)}
                    </td>
                    <td data-label="Valor">
                      <strong>{currency.format(numberValue(item.amount))}</strong>
                    </td>
                    <td data-label="Status">
                      <span className={`financial-status ${itemStatus}`}>
                        {statusLabel(itemStatus, ledger)}
                      </span>
                    </td>
                    <td className="financial-row-actions">
                      {itemStatus === "pending" || itemStatus === "overdue" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onSettle(item)}
                            title={
                              ledger === "receivable" ? "Marcar como recebido" : "Marcar como pago"
                            }
                          >
                            <BadgeDollarSign />
                          </button>
                          <button type="button" onClick={() => onEdit(item)} title="Editar">
                            <Pencil />
                          </button>
                          <button type="button" onClick={() => onDelete(item)} title="Excluir">
                            <Trash2 />
                          </button>
                        </>
                      ) : settled ? (
                        <button type="button" onClick={() => onReverse(item)} title="Estornar">
                          <RotateCcw />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 ? (
        <div className="financial-pagination">
          <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
            Anterior
          </button>
          <span>
            Página {page} de {pages}
          </span>
          <button
            type="button"
            disabled={page === pages}
            onClick={() => setPage((value) => value + 1)}
          >
            Próxima
          </button>
        </div>
      ) : null}
    </section>
  );
}

function TransactionsSection({
  data,
  onCreate,
  onEdit,
  onDelete
}: {
  data: FinancialSnapshot;
  onCreate: () => void;
  onEdit: (item: FinancialRecord) => void;
  onDelete: (item: FinancialRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const rows = useMemo(() => {
    const active = data.transactions
      .filter((item) => !item.reversed_at)
      .sort((a, b) => scalar(a.occurred_on).localeCompare(scalar(b.occurred_on)));
    const first = data.series[0];
    let balance = (first?.balance ?? 0) - (first?.income ?? 0) + (first?.expense ?? 0);
    const balances = new Map<string, number>();
    for (const item of active) {
      balance +=
        scalar(item.type) === "income" ? numberValue(item.amount) : -numberValue(item.amount);
      balances.set(item.id, balance);
    }
    return [...data.transactions]
      .filter(
        (item) =>
          (!type || scalar(item.type) === type) &&
          (!query ||
            `${scalar(item.description)} ${scalar(item.category_name)} ${scalar(item.origin)}`
              .toLocaleLowerCase("pt-BR")
              .includes(query.toLocaleLowerCase("pt-BR")))
      )
      .sort((a, b) =>
        `${scalar(b.occurred_on)}${scalar(b.created_at)}`.localeCompare(
          `${scalar(a.occurred_on)}${scalar(a.created_at)}`
        )
      )
      .map((item): FinancialRecord => ({ ...item, running_balance: balances.get(item.id) }));
  }, [data, query, type]);
  return (
    <section className="panel-card financial-list-section">
      <div className="financial-section-heading">
        <div>
          <h2>Lançamentos / extrato</h2>
          <p>Movimentos automáticos permanecem vinculados à origem.</p>
        </div>
        <button className="primary-button" type="button" onClick={onCreate}>
          <Plus />
          Novo lançamento
        </button>
      </div>
      <div className="financial-list-filters">
        <label className="financial-search">
          <Search />
          <input
            aria-label="Pesquisar lançamento"
            placeholder="Pesquisar lançamento"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="Filtrar tipo"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          <option value="">Entradas e saídas</option>
          <option value="income">Entradas</option>
          <option value="expense">Saídas</option>
        </select>
      </div>
      {rows.length === 0 ? (
        <div className="admin-empty-state">
          <h3>Nenhum lançamento no período</h3>
          <p>Movimentações realizadas aparecerão aqui.</p>
        </div>
      ) : (
        <div className="financial-table-wrap">
          <table className="financial-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Descrição</th>
                <th>Origem</th>
                <th>Conta</th>
                <th>Valor</th>
                <th>Saldo acumulado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id} className={item.reversed_at ? "reversed" : ""}>
                  <td data-label="Data">{formattedDate(item.occurred_on)}</td>
                  <td data-label="Tipo">
                    <span className={`financial-kind ${scalar(item.type)}`}>
                      {scalar(item.type) === "income" ? "Entrada" : "Saída"}
                    </span>
                  </td>
                  <td data-label="Descrição">
                    <strong>{recordLabel(item, "description")}</strong>
                    <small>{recordLabel(item, "category_name")}</small>
                  </td>
                  <td data-label="Origem">
                    {(
                      {
                        manual: "Manual",
                        receivable: "Conta a receber",
                        payable: "Conta a pagar",
                        contribution: "Aporte"
                      } as Record<string, string>
                    )[scalar(item.origin)] ?? scalar(item.origin)}
                  </td>
                  <td data-label="Conta">
                    {recordLabel(item, "account_name")}
                    <small>{recordLabel(item, "responsible_name")}</small>
                  </td>
                  <td data-label="Valor">
                    <strong>{currency.format(numberValue(item.amount))}</strong>
                  </td>
                  <td data-label="Saldo">
                    {item.reversed_at
                      ? "Estornado"
                      : currency.format(numberValue(item.running_balance))}
                  </td>
                  <td className="financial-row-actions">
                    {scalar(item.origin) === "manual" && !item.reversed_at ? (
                      <>
                        <button type="button" title="Editar" onClick={() => onEdit(item)}>
                          <Pencil />
                        </button>
                        <button type="button" title="Estornar" onClick={() => onDelete(item)}>
                          <Trash2 />
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ContributionsSection({
  data,
  onCreate,
  onEdit
}: {
  data: FinancialSnapshot;
  onCreate: () => void;
  onEdit: (item: FinancialRecord) => void;
}) {
  return (
    <div className="financial-contributions">
      <section className="financial-contribution-summary">
        {data.contribution_groups.map((group) => (
          <article className="panel-card" key={group.id}>
            <span>{group.name}</span>
            <strong>{currency.format(group.realized)}</strong>
            <dl>
              <div>
                <dt>Participação</dt>
                <dd>{group.expected_percentage.toLocaleString("pt-BR")}%</dd>
              </div>
              <div>
                <dt>Ideal no período</dt>
                <dd>{currency.format(group.ideal)}</dd>
              </div>
              <div>
                <dt>Diferença</dt>
                <dd className={group.difference < 0 ? "negative" : "positive"}>
                  {currency.format(group.difference)}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </section>
      {data.contribution_partners.length ? (
        <section className="panel-card financial-partner-totals">
          <h2>Realizado por sócio</h2>
          <div>
            {data.contribution_partners.map((partner) => (
              <article key={partner.id}>
                <span>
                  <strong>{partner.name}</strong>
                  <small>{partner.group_name}</small>
                </span>
                <strong>{currency.format(partner.realized)}</strong>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <section className="panel-card financial-list-section">
        <div className="financial-section-heading">
          <div>
            <h2>Aportes dos sócios</h2>
            <p>Todo aporte gera uma entrada automática no caixa.</p>
          </div>
          <button className="primary-button" type="button" onClick={onCreate}>
            <Plus />
            Novo aporte
          </button>
        </div>
        {data.contributions.length === 0 ? (
          <div className="admin-empty-state">
            <h3>Nenhum aporte registrado</h3>
            <p>Configure os grupos e sócios antes do primeiro aporte.</p>
          </div>
        ) : (
          <div className="financial-table-wrap">
            <table className="financial-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Sócio / grupo</th>
                  <th>Descrição</th>
                  <th>Conta</th>
                  <th>Valor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.contributions.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Data">{formattedDate(item.contributed_on)}</td>
                    <td data-label="Sócio / grupo">
                      <strong>{recordLabel(item, "partner_name", "group_name")}</strong>
                      <small>
                        {scalar(item.partner_name) ? recordLabel(item, "group_name") : "Grupo"}
                      </small>
                    </td>
                    <td data-label="Descrição">{recordLabel(item, "description")}</td>
                    <td data-label="Conta">{recordLabel(item, "account_name")}</td>
                    <td data-label="Valor">
                      <strong>{currency.format(numberValue(item.amount))}</strong>
                    </td>
                    <td className="financial-row-actions">
                      <button type="button" title="Editar" onClick={() => onEdit(item)}>
                        <Pencil />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SettingsSection({
  data,
  open,
  mutate
}: {
  data: FinancialSnapshot;
  open: (modal: ModalState) => void;
  mutate: (action: string, payload: Record<string, unknown>, success: string) => Promise<boolean>;
}) {
  const groupsById = new Map(
    data.partner_groups.map((item) => [item.id, recordLabel(item, "name")])
  );
  const blocks = [
    {
      title: "Contas financeiras",
      items: data.accounts,
      kind: "account" as const,
      detail: (item: FinancialRecord) => currency.format(numberValue(item.initial_balance))
    },
    {
      title: "Categorias",
      items: data.categories,
      kind: "category" as const,
      detail: (item: FinancialRecord) =>
        (
          ({ income: "Entrada", expense: "Saída", both: "Entrada e saída" }) as Record<
            string,
            string
          >
        )[scalar(item.kind)] ?? ""
    },
    {
      title: "Grupos de sócios",
      items: data.partner_groups,
      kind: "group" as const,
      detail: (item: FinancialRecord) =>
        `${numberValue(item.expected_percentage).toLocaleString("pt-BR")}% esperado`
    },
    {
      title: "Sócios",
      items: data.partners,
      kind: "partner" as const,
      detail: (item: FinancialRecord) => groupsById.get(scalar(item.group_id)) ?? "Sem grupo"
    }
  ];
  return (
    <div className="financial-settings">
      <div className="financial-settings-intro panel-card">
        <Settings />
        <div>
          <h2>Configurações financeiras</h2>
          <p>
            Cadastre os dados reais da empresa. Os percentuais ativos dos grupos não podem
            ultrapassar 100%.
          </p>
        </div>
      </div>
      <div className="financial-settings-grid">
        {blocks.map((block) => (
          <section className="panel-card" key={block.title}>
            <div className="financial-section-heading">
              <h3>{block.title}</h3>
              <button type="button" onClick={() => open({ kind: block.kind })}>
                <Plus />
                Adicionar
              </button>
            </div>
            <div className="financial-config-list">
              {block.items.length === 0 ? (
                <p>Nenhum cadastro.</p>
              ) : (
                block.items.map((item) => (
                  <div key={item.id} className={!booleanValue(item.active) ? "inactive" : ""}>
                    <span>
                      <strong>{recordLabel(item, "name")}</strong>
                      <small>{block.detail(item)}</small>
                    </span>
                    <div>
                      <button
                        type="button"
                        title="Editar"
                        onClick={() => open({ kind: block.kind, item })}
                      >
                        <Pencil />
                      </button>
                      <button
                        type="button"
                        title={booleanValue(item.active) ? "Desativar" : "Ativar"}
                        onClick={() =>
                          void mutate(
                            `${block.kind}.save`,
                            {
                              ...item,
                              initial_balance_cents: Math.round(
                                numberValue(item.initial_balance) * 100
                              ),
                              expected_percentage: numberValue(item.expected_percentage),
                              active: !booleanValue(item.active)
                            },
                            `${block.title.slice(0, -1)} atualizado(a).`
                          )
                        }
                      >
                        {booleanValue(item.active) ? <X /> : <RefreshCw />}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function AuditSection({ items }: { items: FinancialRecord[] }) {
  const [query, setQuery] = useState("");
  const filtered = items.filter(
    (item) =>
      !query ||
      `${scalar(item.action)} ${scalar(item.actor_name)} ${scalar(item.entity_type)}`
        .toLocaleLowerCase("pt-BR")
        .includes(query.toLocaleLowerCase("pt-BR"))
  );
  return (
    <section className="panel-card financial-list-section">
      <div className="financial-section-heading">
        <div>
          <h2>Histórico de auditoria</h2>
          <p>Registro imutável das ações relevantes entre os sócios.</p>
        </div>
      </div>
      <label className="financial-search">
        <Search />
        <input
          aria-label="Pesquisar histórico"
          placeholder="Pesquisar usuário ou ação"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="financial-audit-list">
        {filtered.length === 0 ? (
          <p>Nenhuma ação encontrada.</p>
        ) : (
          filtered.map((item) => (
            <article key={item.id}>
              <FileClock />
              <div>
                <strong>{auditActionLabel(scalar(item.action))}</strong>
                <span>
                  por {recordLabel(item, "actor_name", "actor_role")} em{" "}
                  {formattedDate(item.created_at, true)}
                </span>
                {item.reason ? <small>Motivo: {scalar(item.reason)}</small> : null}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
function auditActionLabel(action: string) {
  const map: Record<string, string> = {
    "receivable.create": "Conta a receber criada",
    "receivable.update": "Conta a receber alterada",
    "receivable.settle": "Conta marcada como recebida",
    "receivable.reverse": "Recebimento estornado",
    "receivable.delete": "Conta a receber excluída",
    "payable.create": "Conta a pagar criada",
    "payable.update": "Conta a pagar alterada",
    "payable.settle": "Conta marcada como paga",
    "payable.reverse": "Pagamento estornado",
    "payable.delete": "Conta a pagar excluída",
    "transaction.save": "Lançamento manual salvo",
    "transaction.delete": "Lançamento manual estornado",
    "contribution.save": "Aporte salvo",
    "account.save": "Conta financeira configurada",
    "category.save": "Categoria configurada",
    "group.save": "Grupo de sócios configurado",
    "partner.save": "Sócio configurado",
    "export.log": "Excel financeiro exportado"
  };
  return map[action] ?? action;
}

function FinancialModal({
  modal,
  data,
  pending,
  close,
  mutate
}: {
  modal: ModalState;
  data: FinancialSnapshot;
  pending: boolean;
  close: () => void;
  mutate: (action: string, payload: Record<string, unknown>, success: string) => Promise<boolean>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (
      dialogRef.current?.querySelector<HTMLElement>("input, select, textarea") ??
      dialogRef.current?.querySelector<HTMLElement>("button")
    )?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key !== "Tab") return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)"
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
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close]);

  return (
    <div className="admin-modal-backdrop financial-modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="financial-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="financial-modal-title"
      >
        <button className="financial-modal-close" type="button" onClick={close} aria-label="Fechar">
          <X />
        </button>
        {modal.kind === "ledger" ? (
          <LedgerForm modal={modal} data={data} pending={pending} mutate={mutate} />
        ) : null}
        {modal.kind === "settle" ? (
          <SettleForm modal={modal} data={data} pending={pending} mutate={mutate} />
        ) : null}
        {modal.kind === "transaction" ? (
          <TransactionForm item={modal.item} data={data} pending={pending} mutate={mutate} />
        ) : null}
        {modal.kind === "contribution" ? (
          <ContributionForm item={modal.item} data={data} pending={pending} mutate={mutate} />
        ) : null}
        {modal.kind === "account" ||
        modal.kind === "category" ||
        modal.kind === "group" ||
        modal.kind === "partner" ? (
          <ConfigForm modal={modal} data={data} pending={pending} mutate={mutate} />
        ) : null}
      </section>
    </div>
  );
}

function formValue(form: FormData, key: string) {
  return scalar(form.get(key));
}
function activeItems(items: FinancialRecord[]) {
  return items.filter((item) => booleanValue(item.active));
}
function SubmitButton({ pending, label = "Salvar" }: { pending: boolean; label?: string }) {
  return (
    <button className="primary-button" type="submit" disabled={pending}>
      {pending ? <LoaderCircle className="spin" /> : null}
      {label}
    </button>
  );
}

function LedgerForm({
  modal,
  data,
  pending,
  mutate
}: {
  modal: Extract<ModalState, { kind: "ledger" }>;
  data: FinancialSnapshot;
  pending: boolean;
  mutate: (a: string, p: Record<string, unknown>, s: string) => Promise<boolean>;
}) {
  const item = modal.item;
  const ledger = modal.ledger;
  const [count, setCount] = useState(1);
  const [amount, setAmount] = useState(
    item ? numberValue(item.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : ""
  );
  const [dueOn, setDueOn] = useState(item ? scalar(item.due_on) : today());
  const [intervalPreset, setIntervalPreset] = useState("30");
  const [customInterval, setCustomInterval] = useState("45");
  const intervalDays =
    intervalPreset === "30_60"
      ? 30
      : intervalPreset === "custom"
        ? Math.max(1, Math.min(365, Number(customInterval) || 1))
        : Number(intervalPreset);
  const cents = moneyToCents(amount);
  const preview =
    cents && count > 1 && /^\d{4}-\d{2}-\d{2}$/.test(dueOn) && cents >= count
      ? splitInstallments(cents, count)
      : [];
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountCents = moneyToCents(formValue(form, "amount"));
    if (!amountCents) return;
    const payload = {
      id: item?.id ?? "",
      party: formValue(form, "party"),
      description: formValue(form, "description"),
      category_id: formValue(form, "category_id"),
      issued_on: formValue(form, "issued_on"),
      due_on: dueOn,
      document_number: formValue(form, "document_number"),
      amount_cents: amountCents,
      account_id: formValue(form, "account_id"),
      notes: formValue(form, "notes"),
      installment_count: count,
      interval_days: intervalDays
    };
    void mutate(
      `${ledger}.${item ? "update" : "create"}`,
      payload,
      item ? "Conta atualizada." : `${count} conta(s) criada(s) com parcelas conferidas.`
    );
  };
  return (
    <>
      <div className="financial-modal-title">
        <BadgeDollarSign />
        <div>
          <span>{ledger === "receivable" ? "Contas a receber" : "Contas a pagar"}</span>
          <h2 id="financial-modal-title">{item ? "Editar conta" : "Nova conta"}</h2>
        </div>
      </div>
      <form className="financial-form" onSubmit={submit}>
        <div className="financial-form-grid">
          <label>
            <span>{ledger === "receivable" ? "Cliente" : "Fornecedor"}</span>
            <input
              name="party"
              required
              minLength={2}
              maxLength={160}
              defaultValue={
                item ? recordLabel(item, ledger === "receivable" ? "customer" : "supplier") : ""
              }
            />
          </label>
          <label>
            <span>Descrição</span>
            <input
              name="description"
              required
              minLength={2}
              maxLength={240}
              defaultValue={item ? scalar(item.description) : ""}
            />
          </label>
          <label>
            <span>Categoria</span>
            <select name="category_id" required defaultValue={item ? scalar(item.category_id) : ""}>
              <option value="">Selecione</option>
              {activeItems(data.categories)
                .filter((category) =>
                  ["both", ledger === "receivable" ? "income" : "expense"].includes(
                    scalar(category.kind)
                  )
                )
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {recordLabel(category, "name")}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Emissão / compra</span>
            <input
              name="issued_on"
              type="date"
              required
              defaultValue={item ? scalar(item.issued_on) : today()}
            />
          </label>
          <label>
            <span>Primeiro vencimento</span>
            <input
              name="due_on"
              type="date"
              required
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
            />
          </label>
          <label>
            <span>Número / documento</span>
            <input
              name="document_number"
              maxLength={100}
              defaultValue={item ? scalar(item.document_number) : ""}
            />
          </label>
          <label>
            <span>{item ? "Valor" : "Valor total"}</span>
            <input
              name="amount"
              inputMode="decimal"
              required
              placeholder="R$ 0,00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              onBlur={(event) => {
                const value = moneyToCents(event.currentTarget.value);
                if (value !== null) setAmount(centsToMoneyInput(value));
              }}
            />
          </label>
          <label>
            <span>Conta {ledger === "receivable" ? "de destino" : "utilizada"}</span>
            <select
              name="account_id"
              defaultValue={
                item
                  ? scalar(
                      item[ledger === "receivable" ? "destination_account_id" : "source_account_id"]
                    )
                  : ""
              }
            >
              <option value="">Definir ao liquidar</option>
              {activeItems(data.accounts).map((account) => (
                <option key={account.id} value={account.id}>
                  {recordLabel(account, "name")}
                </option>
              ))}
            </select>
          </label>
          {!item ? (
            <>
              <label>
                <span>Número de parcelas</span>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={count}
                  onChange={(event) =>
                    setCount(Math.max(1, Math.min(120, Number(event.target.value) || 1)))
                  }
                />
              </label>
              <label>
                <span>Intervalo</span>
                <select
                  value={intervalPreset}
                  onChange={(event) => setIntervalPreset(event.target.value)}
                >
                  <option value="7">7 dias</option>
                  <option value="15">15 dias</option>
                  <option value="30">30 dias</option>
                  <option value="30_60">30/60 (parcelas mensais)</option>
                  <option value="custom">Personalizado</option>
                </select>
              </label>
              {intervalPreset === "custom" ? (
                <label>
                  <span>Dias entre parcelas</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    required
                    value={customInterval}
                    onChange={(event) => setCustomInterval(event.target.value)}
                  />
                </label>
              ) : null}
            </>
          ) : null}
          <label className="full">
            <span>Observações</span>
            <textarea
              name="notes"
              rows={3}
              maxLength={2000}
              defaultValue={item ? scalar(item.notes) : ""}
            />
          </label>
        </div>
        {preview.length ? (
          <div className="installment-preview">
            <strong>Prévia das parcelas</strong>
            {preview.slice(0, 12).map((part, index) => (
              <span key={index + 1}>
                {index + 1}/{count} · {currency.format(part / 100)} ·{" "}
                {formattedDate(addDays(dueOn, index * intervalDays))}
              </span>
            ))}
            {preview.length > 12 ? <small>+ {preview.length - 12} parcelas</small> : null}
          </div>
        ) : null}
        <div className="financial-form-actions">
          <SubmitButton pending={pending} />
        </div>
      </form>
    </>
  );
}
function SettleForm({
  modal,
  data,
  pending,
  mutate
}: {
  modal: Extract<ModalState, { kind: "settle" }>;
  data: FinancialSnapshot;
  pending: boolean;
  mutate: (a: string, p: Record<string, unknown>, s: string) => Promise<boolean>;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate(
      `${modal.ledger}.settle`,
      {
        id: modal.item.id,
        settled_on: formValue(form, "settled_on"),
        account_id: formValue(form, "account_id")
      },
      modal.ledger === "receivable"
        ? "Recebimento registrado e caixa atualizado."
        : "Pagamento registrado e caixa atualizado."
    );
  };
  return (
    <>
      <div className="financial-modal-title">
        <BadgeDollarSign />
        <div>
          <span>Liquidação</span>
          <h2 id="financial-modal-title">
            {modal.ledger === "receivable" ? "Confirmar recebimento" : "Confirmar pagamento"}
          </h2>
        </div>
      </div>
      <p className="financial-modal-copy">
        {recordLabel(modal.item, "description")} ·{" "}
        <strong>{currency.format(numberValue(modal.item.amount))}</strong>
      </p>
      <form className="financial-form" onSubmit={submit}>
        <label>
          <span>Data</span>
          <input name="settled_on" type="date" required defaultValue={today()} />
        </label>
        <label>
          <span>Conta financeira</span>
          <select
            name="account_id"
            required
            defaultValue={scalar(
              modal.item[
                modal.ledger === "receivable" ? "destination_account_id" : "source_account_id"
              ]
            )}
          >
            <option value="">Selecione</option>
            {activeItems(data.accounts).map((account) => (
              <option key={account.id} value={account.id}>
                {recordLabel(account, "name")}
              </option>
            ))}
          </select>
        </label>
        <div className="financial-form-actions">
          <SubmitButton
            pending={pending}
            label={modal.ledger === "receivable" ? "Registrar recebimento" : "Registrar pagamento"}
          />
        </div>
      </form>
    </>
  );
}

function TransactionForm({
  item,
  data,
  pending,
  mutate
}: {
  item?: FinancialRecord;
  data: FinancialSnapshot;
  pending: boolean;
  mutate: (a: string, p: Record<string, unknown>, s: string) => Promise<boolean>;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = moneyToCents(formValue(form, "amount"));
    if (!amount) return;
    void mutate(
      "transaction.save",
      {
        id: item?.id ?? "",
        type: formValue(form, "type"),
        description: formValue(form, "description"),
        category_id: formValue(form, "category_id"),
        account_id: formValue(form, "account_id"),
        amount_cents: amount,
        occurred_on: formValue(form, "occurred_on"),
        notes: formValue(form, "notes")
      },
      "Lançamento manual salvo e caixa atualizado."
    );
  };
  return (
    <>
      <div className="financial-modal-title">
        <WalletCards />
        <div>
          <span>Extrato</span>
          <h2 id="financial-modal-title">
            {item ? "Editar lançamento" : "Novo lançamento manual"}
          </h2>
        </div>
      </div>
      <form className="financial-form" onSubmit={submit}>
        <div className="financial-form-grid">
          <label>
            <span>Tipo</span>
            <select name="type" defaultValue={item ? scalar(item.type) : "expense"}>
              <option value="income">Entrada</option>
              <option value="expense">Saída</option>
            </select>
          </label>
          <label>
            <span>Data</span>
            <input
              name="occurred_on"
              type="date"
              required
              defaultValue={item ? scalar(item.occurred_on) : today()}
            />
          </label>
          <label className="full">
            <span>Descrição</span>
            <input
              name="description"
              required
              minLength={2}
              maxLength={240}
              defaultValue={item ? scalar(item.description) : ""}
            />
          </label>
          <label>
            <span>Categoria</span>
            <select name="category_id" defaultValue={item ? scalar(item.category_id) : ""}>
              <option value="">Sem categoria</option>
              {activeItems(data.categories).map((category) => (
                <option key={category.id} value={category.id}>
                  {recordLabel(category, "name")}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Conta</span>
            <select name="account_id" required defaultValue={item ? scalar(item.account_id) : ""}>
              <option value="">Selecione</option>
              {activeItems(data.accounts).map((account) => (
                <option key={account.id} value={account.id}>
                  {recordLabel(account, "name")}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Valor</span>
            <input
              name="amount"
              inputMode="decimal"
              required
              onBlur={normalizeMoneyField}
              defaultValue={
                item
                  ? numberValue(item.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })
                  : ""
              }
            />
          </label>
          <label className="full">
            <span>Observações</span>
            <textarea
              name="notes"
              rows={3}
              maxLength={2000}
              defaultValue={item ? scalar(item.notes) : ""}
            />
          </label>
        </div>
        <div className="financial-form-actions">
          <SubmitButton pending={pending} />
        </div>
      </form>
    </>
  );
}

function ContributionForm({
  item,
  data,
  pending,
  mutate
}: {
  item?: FinancialRecord;
  data: FinancialSnapshot;
  pending: boolean;
  mutate: (a: string, p: Record<string, unknown>, s: string) => Promise<boolean>;
}) {
  const initialTarget = item?.partner_id
    ? `partner:${scalar(item.partner_id)}`
    : item?.group_id
      ? `group:${scalar(item.group_id)}`
      : "";
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = moneyToCents(formValue(form, "amount"));
    if (!amount) return;
    const [targetType, targetId] = formValue(form, "target").split(":");
    void mutate(
      "contribution.save",
      {
        id: item?.id ?? "",
        partner_id: targetType === "partner" ? targetId : "",
        group_id: targetType === "group" ? targetId : "",
        account_id: formValue(form, "account_id"),
        category_id: formValue(form, "category_id"),
        contributed_on: formValue(form, "contributed_on"),
        amount_cents: amount,
        description: formValue(form, "description"),
        notes: formValue(form, "notes")
      },
      "Aporte salvo e entrada atualizada no caixa."
    );
  };
  return (
    <>
      <div className="financial-modal-title">
        <Users />
        <div>
          <span>Sócios</span>
          <h2 id="financial-modal-title">{item ? "Editar aporte" : "Novo aporte"}</h2>
        </div>
      </div>
      <form className="financial-form" onSubmit={submit}>
        <div className="financial-form-grid">
          <label>
            <span>Sócio ou grupo</span>
            <select name="target" required defaultValue={initialTarget}>
              <option value="">Selecione</option>
              <optgroup label="Sócios">
                {activeItems(data.partners).map((partner) => (
                  <option key={partner.id} value={`partner:${partner.id}`}>
                    {recordLabel(partner, "name")}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Grupos">
                {activeItems(data.partner_groups).map((group) => (
                  <option key={group.id} value={`group:${group.id}`}>
                    {recordLabel(group, "name")}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label>
            <span>Data</span>
            <input
              name="contributed_on"
              type="date"
              required
              defaultValue={item ? scalar(item.contributed_on) : today()}
            />
          </label>
          <label className="full">
            <span>Descrição</span>
            <input
              name="description"
              required
              minLength={2}
              maxLength={240}
              defaultValue={item ? scalar(item.description) : "Aporte de capital"}
            />
          </label>
          <label>
            <span>Valor</span>
            <input
              name="amount"
              inputMode="decimal"
              required
              onBlur={normalizeMoneyField}
              defaultValue={
                item
                  ? numberValue(item.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })
                  : ""
              }
            />
          </label>
          <label>
            <span>Conta de destino</span>
            <select name="account_id" required defaultValue={item ? scalar(item.account_id) : ""}>
              <option value="">Selecione</option>
              {activeItems(data.accounts).map((account) => (
                <option key={account.id} value={account.id}>
                  {recordLabel(account, "name")}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Categoria</span>
            <select name="category_id" defaultValue={item ? scalar(item.category_id) : ""}>
              <option value="">Sem categoria</option>
              {activeItems(data.categories)
                .filter((category) => ["income", "both"].includes(scalar(category.kind)))
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {recordLabel(category, "name")}
                  </option>
                ))}
            </select>
          </label>
          <label className="full">
            <span>Observações</span>
            <textarea
              name="notes"
              rows={3}
              maxLength={2000}
              defaultValue={item ? scalar(item.notes) : ""}
            />
          </label>
        </div>
        <div className="financial-form-actions">
          <SubmitButton pending={pending} />
        </div>
      </form>
    </>
  );
}

function ConfigForm({
  modal,
  data,
  pending,
  mutate
}: {
  modal: Extract<ModalState, { kind: "account" | "category" | "group" | "partner" }>;
  data: FinancialSnapshot;
  pending: boolean;
  mutate: (a: string, p: Record<string, unknown>, s: string) => Promise<boolean>;
}) {
  const item = modal.item;
  const titles = {
    account: "Conta financeira",
    category: "Categoria",
    group: "Grupo de sócios",
    partner: "Sócio"
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      id: item?.id ?? "",
      name: formValue(form, "name"),
      active: item ? booleanValue(item.active) : true
    };
    if (modal.kind === "account")
      payload.initial_balance_cents = moneyToCents(formValue(form, "initial_balance")) ?? 0;
    if (modal.kind === "category") payload.kind = formValue(form, "kind");
    if (modal.kind === "group")
      payload.expected_percentage = Number(
        formValue(form, "expected_percentage").replace(",", ".")
      );
    if (modal.kind === "partner") payload.group_id = formValue(form, "group_id");
    void mutate(`${modal.kind}.save`, payload, `${titles[modal.kind]} salvo(a).`);
  };
  return (
    <>
      <div className="financial-modal-title">
        <Settings />
        <div>
          <span>Configuração</span>
          <h2 id="financial-modal-title">
            {item ? "Editar" : "Adicionar"} {titles[modal.kind].toLocaleLowerCase("pt-BR")}
          </h2>
        </div>
      </div>
      <form className="financial-form" onSubmit={submit}>
        <label>
          <span>Nome</span>
          <input
            name="name"
            required
            minLength={2}
            maxLength={100}
            defaultValue={item ? scalar(item.name) : ""}
          />
        </label>
        {modal.kind === "account" ? (
          <label>
            <span>Saldo inicial</span>
            <input
              name="initial_balance"
              inputMode="decimal"
              required
              onBlur={normalizeMoneyField}
              defaultValue={
                item
                  ? numberValue(item.initial_balance).toLocaleString("pt-BR", {
                      minimumFractionDigits: 2
                    })
                  : "0,00"
              }
            />
          </label>
        ) : null}
        {modal.kind === "category" ? (
          <label>
            <span>Aplicação</span>
            <select name="kind" defaultValue={item ? scalar(item.kind) : "both"}>
              <option value="both">Entrada e saída</option>
              <option value="income">Somente entrada</option>
              <option value="expense">Somente saída</option>
            </select>
          </label>
        ) : null}
        {modal.kind === "group" ? (
          <label>
            <span>Participação esperada (%)</span>
            <input
              name="expected_percentage"
              type="number"
              min={0}
              max={100}
              step="0.01"
              required
              defaultValue={item ? numberValue(item.expected_percentage) : ""}
            />
          </label>
        ) : null}
        {modal.kind === "partner" ? (
          <label>
            <span>Grupo</span>
            <select name="group_id" required defaultValue={item ? scalar(item.group_id) : ""}>
              <option value="">Selecione</option>
              {activeItems(data.partner_groups).map((group) => (
                <option key={group.id} value={group.id}>
                  {recordLabel(group, "name")}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="financial-form-actions">
          <SubmitButton pending={pending} />
        </div>
      </form>
    </>
  );
}
