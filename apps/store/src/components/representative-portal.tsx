"use client";

import { formatBRL } from "@curtiz/domain";
import {
  BadgeDollarSign,
  Bell,
  BookOpen,
  Boxes,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  FileImage,
  FileText,
  Goal,
  Heart,
  History,
  House,
  LifeBuoy,
  Link2,
  LoaderCircle,
  Menu,
  PackageCheck,
  ReceiptText,
  Search,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  UserRound,
  UsersRound,
  WalletCards,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { type CSSProperties, type FormEvent, useEffect, useState } from "react";
import { LogoutButton } from "@/components/logout-button";
import { readString } from "@/lib/unknown-data";

type Snapshot = {
  demo: boolean;
  representative: null | {
    publicCode: string;
    referralCode: string;
    status: string;
    levelName: string | null;
    levelDescription?: string | null;
    fullName?: string;
    email?: string;
    phone?: string | null;
    regionCode: string;
    activatedAt?: string | null;
  };
  application: null | { status: string; reason?: string };
  kitOrders?: Array<{
    id: string;
    publicCode: string;
    kitName: string;
    status: string;
    totalInCents: number;
  }>;
  sales?: Array<{
    id: string;
    publicCode: string;
    totalInCents: number;
    status: string;
    soldAt: string;
    paymentMethod?: string | null;
    notes?: string | null;
    items?: Array<{ quantity: number; snapshot: Record<string, unknown> }>;
  }>;
  inventory?: Array<{
    variantId: string;
    productName: string;
    sku: string;
    color: string;
    size: string;
    priceInCents: number;
    quantity: number;
  }>;
  inventoryMovements?: Array<{
    id: string;
    variantId: string;
    quantityDelta: number;
    reason: string;
    sourceType: string;
    createdAt: string;
  }>;
  availableKits?: Array<{
    id: string;
    name: string;
    description: string;
    priceInCents: number;
    requiredForActivation: boolean;
    demo?: true;
  }>;
  qualifications?: Array<{
    id: string;
    name: string;
    qualified: boolean;
    periodStart: string;
    periodEnd: string;
    metrics: Record<string, unknown>;
    criteria: Record<string, unknown>;
    evaluatedAt: string;
  }>;
  goals?: Array<{
    id: string;
    title: string;
    periodStart: string;
    periodEnd: string;
    target: Record<string, unknown>;
  }>;
  levelHistory?: Array<{ id: string; levelName: string; reason: string; createdAt: string }>;
  team?: Array<{
    id: string;
    publicCode: string;
    displayName: string;
    status: string;
    levelName: string | null;
    depth: number;
    joinedAt: string;
  }>;
  commissions?: Array<{
    id: string;
    status: string;
    eligibleInCents: number;
    amountInCents: number;
    createdAt: string;
    saleCode: string;
  }>;
  payments?: Array<{
    id: string;
    amountInCents: number;
    status: string;
    paidAt: string | null;
    createdAt: string;
  }>;
  documents?: Array<{
    id: string;
    type: string;
    validUntil: string | null;
    createdAt: string;
    signedUrl: string | null;
  }>;
  contracts?: Array<{
    id: string;
    version: string;
    acceptedAt: string;
    signedUrl: string | null;
  }>;
  trainings?: Array<{
    id: string;
    code: string;
    status: string;
    progress: number;
    completedAt: string | null;
  }>;
  notifications?: Array<{
    id: string;
    title: string;
    body: string;
    actionPath: string | null;
    readAt: string | null;
    createdAt: string;
  }>;
  pagination?: {
    sales: { page: number; pageSize: number; total: number };
    team: { page: number; pageSize: number; total: number };
  };
  creatives?: Array<{
    id: string;
    title: string;
    campaign: string;
    type: string;
    platform: string;
    caption: string;
    signedUrl?: string | null;
    favorite?: boolean;
    demo?: true;
  }>;
};

const navigation = [
  ["Visão geral", "", House],
  ["Meu perfil", "perfil", UserRound],
  ["Meu nível", "nivel", BriefcaseBusiness],
  ["Qualificação", "qualificacao", ShieldCheck],
  ["Metas", "metas", Goal],
  ["Meus kits", "kits", PackageCheck],
  ["Comprar kit", "comprar-kit", ShoppingBag],
  ["Meu estoque", "estoque", Boxes],
  ["Movimentações", "movimentacoes", History],
  ["Registrar venda", "registrar-venda", ReceiptText],
  ["Minhas vendas", "vendas", ClipboardList],
  ["Link de indicação", "indicacao", Link2],
  ["Minha equipe", "equipe", UsersRound],
  ["Comissões", "comissoes", BadgeDollarSign],
  ["Pagamentos", "pagamentos", WalletCards],
  ["Criativos", "criativos", FileImage],
  ["Treinamentos", "treinamentos", BookOpen],
  ["Documentos", "documentos", FileText],
  ["Notificações", "notificacoes", Bell],
  ["Atendimento", "atendimento", LifeBuoy]
] as const;

export function RepresentativePortal({ section }: { section: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [page, setPage] = useState(1);

  const load = (targetPage = page) => {
    setError("");
    void fetch(`/api/representatives?page=${targetPage}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.assign(`/login?next=/representante${section ? `/${section}` : ""}`);
          return null;
        }
        const result = (await response.json()) as Snapshot & { message?: string };
        if (!response.ok) throw new Error(result.message ?? "Não foi possível carregar o portal.");
        if (!result.representative) return result;
        const creativeResponse = await fetch("/api/creatives", { cache: "no-store" });
        if (!creativeResponse.ok) return result;
        const creativeResult = (await creativeResponse.json()) as {
          creatives?: Array<Record<string, unknown>>;
        };
        result.creatives = (creativeResult.creatives ?? []).map((creative) => ({
          id: readString(creative, "id"),
          title: readString(creative, "title", "Criativo"),
          campaign:
            readString(creative, "campaign") ||
            readString(creative, "description", "Material Curtiz"),
          type: readString(creative, "type") || readString(creative, "asset_type", "caption"),
          platform: readString(creative, "platform", "Canal não informado"),
          caption: readString(creative, "caption") || readString(creative, "caption_text"),
          signedUrl: typeof creative.signedUrl === "string" ? creative.signedUrl : null,
          favorite: creative.favorite === true,
          ...(creative.demo === true ? { demo: true as const } : {})
        }));
        return result;
      })
      .then((result) => result && setSnapshot(result))
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Falha inesperada.")
      );
  };

  useEffect(() => {
    setPage(1);
    load(1);
  }, [section]);

  if (error)
    return (
      <main className="container page-shell">
        <div className="error-state">
          <h1>Portal indisponível</h1>
          <p>{error}</p>
          <button className="primary-button" onClick={() => load()}>
            Tentar novamente
          </button>
        </div>
      </main>
    );
  if (!snapshot)
    return (
      <main className="representative-loading">
        <LoaderCircle className="spin" />
        <span>Carregando portal</span>
      </main>
    );
  if (!snapshot.representative) {
    return (
      <main className="container page-shell">
        <section className="application-status-state">
          <span>
            <ClipboardList />
          </span>
          <p className="eyebrow">Programa de representantes</p>
          <h1>
            {snapshot.application ? "Sua solicitação está em andamento" : "Envie sua solicitação"}
          </h1>
          <p>
            {snapshot.application
              ? `Status atual: ${statusLabel(snapshot.application.status)}.`
              : "Conclua as seis etapas para iniciar a análise."}
          </p>
          <Link className="primary-button" href="/representante/solicitacao">
            {snapshot.application ? "Acompanhar solicitação" : "Começar agora"}
          </Link>
        </section>
      </main>
    );
  }

  return (
    <div className="representative-portal-layout">
      {menuOpen && (
        <button
          className="representative-backdrop"
          aria-label="Fechar menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className={menuOpen ? "representative-sidebar open" : "representative-sidebar"}>
        <header>
          <Link href="/representante" className="representative-brand">
            CURTIZ <small>Representantes</small>
          </Link>
          <button onClick={() => setMenuOpen(false)} aria-label="Fechar menu">
            <X />
          </button>
        </header>
        <nav aria-label="Portal da representante">
          {navigation.map(([label, route, Icon]) => (
            <Link
              className={route === section ? "active" : ""}
              href={route ? `/representante/${route}` : "/representante"}
              onClick={() => setMenuOpen(false)}
              key={label}
            >
              <Icon />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="representative-sidebar-footer">
          <Link className="representative-customer-link" href="/minha-conta">
            <UserRound /> Voltar à área de cliente
          </Link>
          <LogoutButton className="representative-logout-button" />
        </div>
      </aside>
      <div className="representative-main">
        <header className="representative-topbar">
          <button
            className="representative-menu-button"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu />
          </button>
          <div>
            <small>Portal profissional</small>
            <strong>{snapshot.representative.publicCode}</strong>
          </div>
          <Link className="representative-notification-link" href="/representante/notificacoes">
            <Bell />
            {(snapshot.notifications ?? []).filter((item) => !item.readAt).length > 0 && (
              <span>{(snapshot.notifications ?? []).filter((item) => !item.readAt).length}</span>
            )}
            <span className="sr-only">Notificações</span>
          </Link>
          <span className={`representative-status ${snapshot.representative.status}`}>
            {statusLabel(snapshot.representative.status)}
          </span>
        </header>
        <main className="representative-content">
          {snapshot.demo && (
            <p className="demo-banner">
              Ambiente de demonstração · informações fictícias identificadas
            </p>
          )}
          {["suspended", "cancelled", "inactive"].includes(snapshot.representative.status) && (
            <div className="representative-access-alert" role="status">
              <ShieldCheck />
              <div>
                <strong>Acesso profissional limitado</strong>
                <p>
                  Seu histórico permanece disponível, mas novas vendas, kits, rede e materiais
                  podem ficar bloqueados enquanto o status estiver {statusLabel(snapshot.representative.status).toLocaleLowerCase("pt-BR")}.
                </p>
              </div>
            </div>
          )}
          <PortalSection
            section={section}
            snapshot={snapshot}
            onRefresh={() => load(page)}
            onPageChange={(nextPage) => {
              setPage(nextPage);
              load(nextPage);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </main>
      </div>
    </div>
  );
}

function PortalSection({
  section,
  snapshot,
  onRefresh,
  onPageChange
}: {
  section: string;
  snapshot: Snapshot;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
}) {
  const representative = snapshot.representative!;
  if (!section) return <Overview snapshot={snapshot} />;
  if (section === "perfil")
    return <Profile representative={representative} onSaved={onRefresh} />;
  if (section === "nivel")
    return <Level representative={representative} history={snapshot.levelHistory ?? []} />;
  if (section === "qualificacao")
    return <Qualifications qualifications={snapshot.qualifications ?? []} />;
  if (section === "metas") return <Goals goals={snapshot.goals ?? []} />;
  if (section === "registrar-venda")
    return <SaleForm inventory={snapshot.inventory ?? []} onSaved={onRefresh} />;
  if (section === "vendas")
    return (
      <Sales
        sales={snapshot.sales ?? []}
        onRefresh={onRefresh}
        pagination={snapshot.pagination?.sales}
        onPageChange={onPageChange}
      />
    );
  if (section === "estoque")
    return <Inventory inventory={snapshot.inventory ?? []} />;
  if (section === "movimentacoes")
    return (
      <Movements
        movements={snapshot.inventoryMovements ?? []}
        inventory={snapshot.inventory ?? []}
      />
    );
  if (section === "equipe")
    return (
      <Team
        members={snapshot.team ?? []}
        pagination={snapshot.pagination?.team}
        onPageChange={onPageChange}
      />
    );
  if (section === "comissoes")
    return <Commissions entries={snapshot.commissions ?? []} />;
  if (section === "pagamentos") return <Payments payments={snapshot.payments ?? []} />;
  if (section === "criativos") return <Creatives creatives={snapshot.creatives ?? []} />;
  if (section === "indicacao") return <Referral referralCode={representative.referralCode} />;
  if (section === "kits" || section === "comprar-kit")
    return (
      <Kits
        orders={snapshot.kitOrders ?? []}
        available={snapshot.availableKits ?? []}
        purchasing={section === "comprar-kit"}
        onRefresh={onRefresh}
      />
    );
  if (section === "treinamentos")
    return <Trainings trainings={snapshot.trainings ?? []} />;
  if (section === "documentos")
    return (
      <Documents
        documents={snapshot.documents ?? []}
        contracts={snapshot.contracts ?? []}
      />
    );
  if (section === "notificacoes")
    return <Notifications notifications={snapshot.notifications ?? []} onRefresh={onRefresh} />;
  if (section === "atendimento")
    return (
      <section>
        <PageTitle
          title="Atendimento"
          description="O suporte humano entra pela fila administrativa e mantém o contexto da sua conta."
        />
        <div className="representative-card">
          <p>Abra uma conversa segura na central de atendimento.</p>
          <Link className="primary-button" href="/minha-conta/atendimento?new=1">
            Falar com atendimento
          </Link>
        </div>
      </section>
    );
  return (
    <section>
      <PageTitle title="Área profissional" description="Conteúdo não disponível para este perfil." />
      <div className="representative-empty">
        <BriefcaseBusiness />
        <h2>Nenhum registro disponível</h2>
        <p>O sistema mostrará apenas dados confirmados pelas regras configuradas.</p>
      </div>
    </section>
  );
}

function Overview({ snapshot }: { snapshot: Snapshot }) {
  const representative = snapshot.representative!;
  const sales = snapshot.sales ?? [];
  const total = sales.reduce((sum, sale) => sum + sale.totalInCents, 0);
  const availableCommission = (snapshot.commissions ?? [])
    .filter((entry) => ["approved", "payable"].includes(entry.status))
    .reduce((sum, entry) => sum + entry.amountInCents, 0);
  const currentQualification = snapshot.qualifications?.[0] ?? null;
  return (
    <>
      <PageTitle
        title="Visão geral"
        description="Acompanhe sua operação sem valores ou metas inventados."
      />
      <section className="representative-referral-card">
        <div>
          <small>Seu código de indicação</small>
          <strong>{representative.referralCode}</strong>
        </div>
        <CopyButton
          value={`${windowOrigin()}/indicar/${representative.referralCode}`}
          label="Copiar link"
        />
      </section>
      <div className="representative-metrics">
        <Metric label="Nível atual" value={representative.levelName ?? "Não atribuído"} />
        <Metric
          label="Qualificação"
          value={
            currentQualification
              ? currentQualification.qualified
                ? "Qualificada"
                : "Não qualificada"
              : "Não avaliada"
          }
        />
        <Metric label="Comissão disponível" value={formatBRL(availableCommission)} />
        <Metric label="Equipe" value={String(snapshot.pagination?.team.total ?? snapshot.team?.length ?? 0)} />
        <Metric label="Status comercial" value={statusLabel(representative.status)} />
        <Metric label="Vendas no histórico" value={String(snapshot.pagination?.sales.total ?? sales.length)} />
        <Metric label="Volume confirmado" value={formatBRL(total)} />
        <Metric label="Kits adquiridos" value={String(snapshot.kitOrders?.length ?? 0)} />
      </div>
      <div className="representative-dashboard-grid">
        <section className="representative-card">
          <h2>Vendas recentes</h2>
          {sales.length ? (
            <Sales sales={sales.slice(0, 4)} compact />
          ) : (
            <p className="quiet-state">Nenhuma venda confirmada.</p>
          )}
        </section>
        <section className="representative-card">
          <h2>Próximas ações</h2>
          <div className="representative-action-list">
            {(snapshot.notifications ?? []).filter((item) => !item.readAt).slice(0, 3).map((item) => (
              <Link href={item.actionPath ?? "/representante/notificacoes"} key={item.id}>
                <span>{item.title}</span>
                <ChevronRight />
              </Link>
            ))}
            {!snapshot.notifications?.some((item) => !item.readAt) && (
              <p className="quiet-state">Nenhuma ação pendente confirmada.</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Profile({
  representative,
  onSaved
}: {
  representative: NonNullable<Snapshot["representative"]>;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const regionValue = form.get("regionCode");
    const regionCode = typeof regionValue === "string" ? regionValue.trim().toUpperCase() : "";
    try {
      await postRepresentativeAction({ action: "update_profile", regionCode });
      setMessage("Perfil profissional atualizado.");
      onSaved();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Não foi possível atualizar.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <section>
      <PageTitle
        title="Meu perfil profissional"
        description="Consulte sua identificação e mantenha a região comercial atualizada."
      />
      <div className="representative-profile-grid">
        <article className="representative-card representative-identity-card">
          <UserRound />
          <div>
            <small>Nome</small>
            <strong>{representative.fullName || "Não informado"}</strong>
          </div>
          <div>
            <small>Código</small>
            <strong>{representative.publicCode}</strong>
          </div>
          <div>
            <small>E-mail de acesso</small>
            <span>{representative.email || "Não informado"}</span>
          </div>
          <div>
            <small>Telefone</small>
            <span>{representative.phone || "Não informado"}</span>
          </div>
        </article>
        <form className="representative-card representative-profile-form" onSubmit={(event) => void submit(event)}>
          <h2>Dados comerciais</h2>
          <label className="field">
            <span>Região de atuação</span>
            <input
              name="regionCode"
              defaultValue={representative.regionCode}
              minLength={2}
              maxLength={8}
              pattern="[A-Za-z]{2,8}"
              required
            />
          </label>
          <p className="field-hint">
            Nome, e-mail e telefone são administrados na área de cliente para manter uma única fonte de dados.
          </p>
          <div className="representative-form-actions">
            <Link className="secondary-button" href="/minha-conta/perfil">
              Editar dados pessoais
            </Link>
            <button className="primary-button" disabled={loading}>
              {loading && <LoaderCircle className="spin" />} Salvar região
            </button>
          </div>
          {message && <p className="form-message" role="status">{message}</p>}
        </form>
      </div>
    </section>
  );
}

function Level({
  representative,
  history
}: {
  representative: NonNullable<Snapshot["representative"]>;
  history: NonNullable<Snapshot["levelHistory"]>;
}) {
  return (
    <section>
      <PageTitle title="Meu nível" description="Nível calculado pelas regras vigentes e histórico de alterações." />
      <article className="representative-card representative-level-card">
        <BriefcaseBusiness />
        <div>
          <small>Nível atual</small>
          <h2>{representative.levelName ?? "Não atribuído"}</h2>
          <p>{representative.levelDescription ?? "Nenhuma regra de nível foi aplicada ao seu perfil."}</p>
        </div>
      </article>
      <RecordList
        title="Histórico de nível"
        empty="Nenhuma alteração de nível registrada."
        rows={history.map((entry) => ({
          id: entry.id,
          title: entry.levelName,
          detail: entry.reason,
          meta: formatDate(entry.createdAt)
        }))}
      />
    </section>
  );
}

function Qualifications({
  qualifications
}: {
  qualifications: NonNullable<Snapshot["qualifications"]>;
}) {
  return (
    <section>
      <PageTitle
        title="Qualificação"
        description="Resultados e critérios das avaliações executadas pelas regras configuradas."
      />
      {qualifications.length ? (
        <div className="representative-record-grid">
          {qualifications.map((item) => (
            <article className="representative-card" key={item.id}>
              <div className="representative-card-heading">
                <div>
                  <small>{formatPeriod(item.periodStart, item.periodEnd)}</small>
                  <h2>{item.name}</h2>
                </div>
                <span className={`representative-pill ${item.qualified ? "success" : "warning"}`}>
                  {item.qualified ? "Qualificada" : "Não qualificada"}
                </span>
              </div>
              <RuleFacts values={item.metrics} empty="Nenhuma métrica publicada." />
              <details>
                <summary>Consultar critérios</summary>
                <RuleFacts values={item.criteria} empty="Critérios não publicados." />
              </details>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState icon={ShieldCheck} title="Nenhuma avaliação concluída" description="A qualificação aparecerá quando uma regra vigente for processada." />
      )}
    </section>
  );
}

function Goals({ goals }: { goals: NonNullable<Snapshot["goals"]> }) {
  return (
    <section>
      <PageTitle title="Metas" description="Metas comerciais configuradas para seu perfil ou nível." />
      {goals.length ? (
        <div className="representative-record-grid">
          {goals.map((goal) => (
            <article className="representative-card" key={goal.id}>
              <small>{formatPeriod(goal.periodStart, goal.periodEnd)}</small>
              <h2>{goal.title}</h2>
              <RuleFacts values={goal.target} empty="Detalhes da meta não publicados." />
            </article>
          ))}
        </div>
      ) : (
        <EmptyState icon={Goal} title="Nenhuma meta vigente" description="Não há uma meta configurada para o período atual." />
      )}
    </section>
  );
}

function Inventory({ inventory }: { inventory: NonNullable<Snapshot["inventory"]> }) {
  const total = inventory.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <section>
      <PageTitle title="Meu estoque" description="Saldo derivado exclusivamente de movimentos confirmados." />
      <div className="representative-metrics">
        <Metric label="Unidades disponíveis" value={String(total)} />
        <Metric label="Variações em estoque" value={String(inventory.filter((item) => item.quantity > 0).length)} />
      </div>
      {inventory.length ? (
        <div className="representative-table-wrap">
          <table className="representative-table">
            <thead><tr><th>Produto</th><th>SKU</th><th>Variação</th><th>Saldo</th></tr></thead>
            <tbody>
              {inventory.map((item) => (
                <tr key={item.variantId}>
                  <td data-label="Produto">{item.productName}</td>
                  <td data-label="SKU">{item.sku}</td>
                  <td data-label="Variação">{[item.color, item.size].filter(Boolean).join(" · ")}</td>
                  <td data-label="Saldo"><strong>{item.quantity}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={Boxes} title="Estoque sem registros" description="Itens serão exibidos após a entrega confirmada de um kit." />
      )}
    </section>
  );
}

function Movements({
  movements,
  inventory
}: {
  movements: NonNullable<Snapshot["inventoryMovements"]>;
  inventory: NonNullable<Snapshot["inventory"]>;
}) {
  const byVariant = new Map(inventory.map((item) => [item.variantId, item]));
  return (
    <section>
      <PageTitle title="Movimentações" description="Trilha imutável de entradas e saídas do estoque profissional." />
      <RecordList
        title="Histórico do estoque"
        empty="Nenhuma movimentação confirmada."
        rows={movements.map((movement) => ({
          id: movement.id,
          title: byVariant.get(movement.variantId)?.productName ?? "Produto",
          detail: movementLabel(movement.reason),
          meta: `${movement.quantityDelta > 0 ? "+" : ""}${movement.quantityDelta} · ${formatDateTime(movement.createdAt)}`
        }))}
      />
    </section>
  );
}

function Team({
  members,
  pagination,
  onPageChange
}: {
  members: NonNullable<Snapshot["team"]>;
  pagination?: { page: number; pageSize: number; total: number };
  onPageChange: (page: number) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = members.filter((member) =>
    `${member.displayName} ${member.publicCode}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))
  );
  return (
    <section>
      <PageTitle title="Minha equipe" description="Rede visível conforme seu vínculo de indicação e suas permissões." />
      <label className="representative-search">
        <Search />
        <span className="sr-only">Buscar na equipe</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome ou código" />
      </label>
      {filtered.length ? (
        <>
          <div className="representative-network">
            {filtered.map((member) => (
              <article className="representative-card" style={{ "--network-depth": Math.min(member.depth, 6) } as CSSProperties} key={member.id}>
                <UserRound />
                <div>
                  <strong>{member.displayName}</strong>
                  <small>{member.publicCode} · Nível {member.depth} da rede</small>
                </div>
                <span className="representative-pill">{statusLabel(member.status)}</span>
                <small>{member.levelName ?? "Sem nível atribuído"}</small>
              </article>
            ))}
          </div>
          {pagination && (
            <Pagination pagination={pagination} onPageChange={onPageChange} />
          )}
        </>
      ) : (
        <EmptyState icon={UsersRound} title="Nenhum membro encontrado" description="Novos vínculos aparecem somente após a validação da indicação." />
      )}
    </section>
  );
}

function Commissions({ entries }: { entries: NonNullable<Snapshot["commissions"]> }) {
  const total = entries.reduce((sum, entry) => sum + entry.amountInCents, 0);
  const payable = entries.filter((entry) => ["approved", "payable"].includes(entry.status)).reduce((sum, entry) => sum + entry.amountInCents, 0);
  return (
    <section>
      <PageTitle title="Comissões" description="Extrato calculado pelas regras versionadas do período." />
      <div className="representative-metrics">
        <Metric label="Total no extrato" value={formatBRL(total)} />
        <Metric label="Disponível" value={formatBRL(payable)} />
      </div>
      <RecordList
        title="Lançamentos"
        empty="Nenhuma comissão calculada."
        rows={entries.map((entry) => ({
          id: entry.id,
          title: entry.saleCode || "Lançamento de comissão",
          detail: statusLabel(entry.status),
          meta: `${formatBRL(entry.amountInCents)} · ${formatDate(entry.createdAt)}`
        }))}
      />
    </section>
  );
}

function Payments({ payments }: { payments: NonNullable<Snapshot["payments"]> }) {
  return (
    <section>
      <PageTitle title="Pagamentos" description="Histórico de repasses processados pela Curtiz." />
      <RecordList
        title="Repasses"
        empty="Nenhum pagamento processado."
        rows={payments.map((payment) => ({
          id: payment.id,
          title: formatBRL(payment.amountInCents),
          detail: statusLabel(payment.status),
          meta: formatDate(payment.paidAt ?? payment.createdAt)
        }))}
      />
    </section>
  );
}

function Trainings({ trainings }: { trainings: NonNullable<Snapshot["trainings"]> }) {
  return (
    <section>
      <PageTitle title="Treinamentos" description="Conteúdos e progresso vinculados ao seu perfil." />
      {trainings.length ? (
        <div className="representative-record-grid">
          {trainings.map((training) => (
            <article className="representative-card" key={training.id}>
              <div className="representative-card-heading">
                <h2>{humanizeCode(training.code)}</h2>
                <span className="representative-pill">{statusLabel(training.status)}</span>
              </div>
              <div className="representative-progress" aria-label={`${training.progress}% concluído`}>
                <span style={{ width: `${training.progress}%` }} />
              </div>
              <small>{training.progress}% concluído</small>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState icon={BookOpen} title="Nenhum treinamento disponível" description="Conteúdos publicados para seu perfil aparecerão aqui." />
      )}
    </section>
  );
}

function Documents({
  documents,
  contracts
}: {
  documents: NonNullable<Snapshot["documents"]>;
  contracts: NonNullable<Snapshot["contracts"]>;
}) {
  return (
    <section>
      <PageTitle title="Documentos e contratos" description="Referências privadas do seu vínculo profissional." />
      <div className="representative-dashboard-grid">
        <PrivateFileList
          title="Documentos"
          empty="Nenhum documento vigente."
          rows={documents.map((document) => ({
            id: document.id,
            title: humanizeCode(document.type),
            detail: document.validUntil ? `Validade: ${formatDate(document.validUntil)}` : "Sem vencimento informado",
            meta: formatDate(document.createdAt),
            signedUrl: document.signedUrl
          }))}
        />
        <PrivateFileList
          title="Contratos aceitos"
          empty="Nenhum contrato registrado."
          rows={contracts.map((contract) => ({
            id: contract.id,
            title: `Versão ${contract.version}`,
            detail: "Aceite registrado",
            meta: formatDateTime(contract.acceptedAt),
            signedUrl: contract.signedUrl
          }))}
        />
      </div>
      <p className="representative-security-note"><ShieldCheck /> Arquivos privados exigem URL assinada e não são expostos diretamente pelo portal.</p>
    </section>
  );
}

function Notifications({
  notifications,
  onRefresh
}: {
  notifications: NonNullable<Snapshot["notifications"]>;
  onRefresh: () => void;
}) {
  const [loadingId, setLoadingId] = useState("");
  const markRead = async (id: string) => {
    if (loadingId) return;
    setLoadingId(id);
    try {
      await postRepresentativeAction({ action: "mark_notification", notificationId: id });
      onRefresh();
    } finally {
      setLoadingId("");
    }
  };
  return (
    <section>
      <PageTitle title="Notificações" description="Avisos transacionais e ações relevantes para seu perfil." />
      {notifications.length ? (
        <div className="representative-notifications">
          {notifications.map((notification) => (
            <article className={`representative-card ${notification.readAt ? "" : "unread"}`} key={notification.id}>
              <Bell />
              <div>
                <strong>{notification.title}</strong>
                <p>{notification.body}</p>
                <small>{formatDateTime(notification.createdAt)}</small>
              </div>
              <div>
                {notification.actionPath && <Link className="text-button" href={notification.actionPath}>Abrir</Link>}
                {!notification.readAt && (
                  <button className="text-button" disabled={loadingId === notification.id} onClick={() => void markRead(notification.id)}>
                    {loadingId === notification.id ? <LoaderCircle className="spin" /> : <Check />} Marcar como lida
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState icon={Bell} title="Nenhuma notificação" description="Você está em dia com os avisos do portal." />
      )}
    </section>
  );
}

function SaleForm({
  inventory,
  onSaved
}: {
  inventory: NonNullable<Snapshot["inventory"]>;
  onSaved: () => void;
}) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState([{ key: crypto.randomUUID(), variantId: "", quantity: 1 }]);
  if (!inventory.some((item) => item.quantity > 0)) {
    return (
      <section>
        <PageTitle
          title="Registrar venda"
          description="As vendas usam exclusivamente itens confirmados no seu estoque."
        />
        <div className="representative-empty">
          <Boxes />
          <h2>Estoque indisponível</h2>
          <p>Receba ou reponha um kit antes de registrar uma venda.</p>
          <Link className="primary-button" href="/representante/comprar-kit">
            Consultar kits
          </Link>
        </div>
      </section>
    );
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const rawReference = form.get("reference");
    const customerReference = typeof rawReference === "string" ? rawReference.trim() : "";
    const soldAtRaw = form.get("soldAt");
    const paymentMethodRaw = form.get("paymentMethod");
    const notesRaw = form.get("notes");
    const soldAtValue = typeof soldAtRaw === "string" ? soldAtRaw : "";
    const paymentMethod = typeof paymentMethodRaw === "string" ? paymentMethodRaw : "";
    const notes = typeof notesRaw === "string" ? notesRaw.trim() : "";
    try {
      const response = await fetch("/api/representatives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "record_sale",
          idempotencyKey: crypto.randomUUID(),
          items: lines.map(({ variantId, quantity }) => ({ variantId, quantity })),
          ...(customerReference ? { customerReference } : {}),
          ...(paymentMethod ? { paymentMethod } : {}),
          ...(notes ? { notes } : {}),
          ...(soldAtValue ? { soldAt: new Date(soldAtValue).toISOString() } : {})
        })
      });
      const result = (await response.json()) as { message?: string; publicCode?: string; warning?: string };
      if (!response.ok) throw new Error(result.message ?? "Não foi possível registrar.");
      setMessage(
        `Venda ${result.publicCode ?? ""} registrada.${result.warning ? ` ${result.warning}` : ""}`
      );
      event.currentTarget.reset();
      setLines([{ key: crypto.randomUUID(), variantId: "", quantity: 1 }]);
      onSaved();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Falha inesperada.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <section>
      <PageTitle
        title="Registrar venda"
        description="Preço, disponibilidade e total são recalculados no servidor antes da baixa do estoque."
      />
      <form
        className="representative-card representative-sale-form"
        onSubmit={(event) => void submit(event)}
      >
        <fieldset className="representative-sale-lines">
          <legend>Itens vendidos</legend>
          {lines.map((line, index) => {
            const selected = inventory.find((item) => item.variantId === line.variantId);
            return (
              <div key={line.key}>
                <label className="field">
                  <span>Produto e variação {index + 1}</span>
                  <select
                    required
                    value={line.variantId}
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((item) =>
                          item.key === line.key ? { ...item, variantId: event.target.value } : item
                        )
                      )
                    }
                  >
                    <option value="" disabled>Selecione um item do estoque</option>
                    {inventory.filter((item) => item.quantity > 0).map((item) => (
                      <option
                        value={item.variantId}
                        disabled={lines.some(
                          (candidate) =>
                            candidate.key !== line.key && candidate.variantId === item.variantId
                        )}
                        key={item.variantId}
                      >
                        {item.productName} · {item.color} · {item.size} · {formatBRL(item.priceInCents)} · {item.quantity} un.
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field representative-quantity-field">
                  <span>Quantidade</span>
                  <input
                    type="number"
                    min={1}
                    max={Math.min(99, selected?.quantity ?? 99)}
                    step={1}
                    value={line.quantity}
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((item) =>
                          item.key === line.key
                            ? { ...item, quantity: Number(event.target.value) }
                            : item
                        )
                      )
                    }
                    required
                  />
                </label>
                {lines.length > 1 && (
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Remover item ${index + 1}`}
                    onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                  >
                    <Trash2 />
                  </button>
                )}
              </div>
            );
          })}
          <button
            className="text-button"
            type="button"
            disabled={lines.length >= Math.min(50, inventory.filter((item) => item.quantity > 0).length)}
            onClick={() =>
              setLines((current) => [
                ...current,
                { key: crypto.randomUUID(), variantId: "", quantity: 1 }
              ])
            }
          >
            Adicionar outro item
          </button>
        </fieldset>
        <div className="representative-form-grid">
          <label className="field">
            <span>Data da venda</span>
            <input name="soldAt" type="datetime-local" max={localDateTimeNow()} />
          </label>
          <label className="field">
            <span>Forma de pagamento</span>
            <select name="paymentMethod" defaultValue="">
              <option value="">Não informada</option>
              <option value="pix">Pix</option>
              <option value="card">Cartão</option>
              <option value="cash">Dinheiro</option>
              <option value="transfer">Transferência</option>
              <option value="other">Outra</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Referência externa (opcional)</span>
          <input
            name="reference"
            maxLength={80}
            pattern="[A-Za-z0-9._/-]+"
            aria-describedby="sale-reference-hint"
          />
          <small id="sale-reference-hint">Não informe nome, CPF, telefone ou outro dado pessoal.</small>
        </label>
        <label className="field">
          <span>Observações operacionais (opcional)</span>
          <textarea name="notes" maxLength={500} rows={3} />
        </label>
        <div className="representative-sale-preview">
          <span>Prévia dos itens</span>
          <strong>
            {formatBRL(
              lines.reduce((sum, line) => {
                const item = inventory.find((candidate) => candidate.variantId === line.variantId);
                return sum + (item?.priceInCents ?? 0) * Math.max(0, line.quantity);
              }, 0)
            )}
          </strong>
          <small>Valor apenas informativo; o servidor recalcula o total final.</small>
        </div>
        <button className="primary-button" disabled={loading}>
          {loading ? <LoaderCircle className="spin" /> : <ReceiptText />} Registrar venda
        </button>
        {message && (
          <p className="form-message" role="status">
            {message}
          </p>
        )}
      </form>
    </section>
  );
}

function Sales({
  sales,
  compact = false,
  onRefresh,
  pagination,
  onPageChange
}: {
  sales: NonNullable<Snapshot["sales"]>;
  compact?: boolean;
  onRefresh?: () => void;
  pagination?: { page: number; pageSize: number; total: number };
  onPageChange?: (page: number) => void;
}) {
  const [status, setStatus] = useState("all");
  const [loadingId, setLoadingId] = useState("");
  const [message, setMessage] = useState("");
  const visible = compact
    ? sales
    : sales.filter((sale) => status === "all" || sale.status === status);
  const cancel = async (saleId: string, correction = false) => {
    const reason = window.prompt(
      correction
        ? "Informe o motivo da correção. A venda atual será cancelada e o estoque estornado:"
        : "Informe o motivo do cancelamento:"
    );
    if (!reason || reason.trim().length < 3 || loadingId) return;
    setLoadingId(saleId);
    setMessage("");
    try {
      await postRepresentativeAction({ action: "cancel_sale", saleId, reason: reason.trim() });
      setMessage("Venda cancelada e estoque estornado.");
      onRefresh?.();
      if (correction) window.location.assign("/representante/registrar-venda");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível cancelar.");
    } finally {
      setLoadingId("");
    }
  };
  return (
    <div className={compact ? "representative-sales compact" : "representative-sales"}>
      {!compact && (
        <>
          <PageTitle title="Minhas vendas" description="Histórico auditável dos registros profissionais." />
          <div className="representative-toolbar">
            <label className="field">
              <span>Status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">Todos</option>
                <option value="confirmed">Confirmadas</option>
                <option value="cancelled">Canceladas</option>
                <option value="refunded">Reembolsadas</option>
              </select>
            </label>
            <Link className="primary-button" href="/representante/registrar-venda">Registrar venda</Link>
          </div>
          {message && <p className="form-message" role="status">{message}</p>}
        </>
      )}
      {visible.length ? (
        visible.map((sale) => (
          <article key={sale.id}>
            <div>
              <strong>{sale.publicCode}</strong>
              <small>{new Intl.DateTimeFormat("pt-BR").format(new Date(sale.soldAt))}</small>
            </div>
            <span>{statusLabel(sale.status)}</span>
            <b>{formatBRL(sale.totalInCents)}</b>
            {!compact && sale.status === "confirmed" && (
              <div className="representative-sale-actions">
                <button className="text-button" disabled={loadingId === sale.id} onClick={() => void cancel(sale.id, true)}>
                  Corrigir
                </button>
                <button
                  className="text-button danger"
                  disabled={loadingId === sale.id}
                  onClick={() => void cancel(sale.id)}
                >
                  {loadingId === sale.id ? <LoaderCircle className="spin" /> : <Trash2 />} Cancelar
                </button>
              </div>
            )}
          </article>
        ))
      ) : (
        <div className="representative-empty">
          <ReceiptText />
          <h2>Nenhuma venda registrada</h2>
        </div>
      )}
      {!compact && pagination && onPageChange && (
        <Pagination pagination={pagination} onPageChange={onPageChange} />
      )}
    </div>
  );
}

function Referral({ referralCode }: { referralCode: string }) {
  const link = referralLink(referralCode);
  return (
    <section>
      <PageTitle
        title="Link de indicação"
        description="Compartilhe seu código pessoal. Vínculos são validados no servidor."
      />
      <div className="representative-card referral-detail">
        <Link2 />
        <strong>{referralCode}</strong>
        <code>{link}</code>
        <CopyButton value={link} label="Copiar link" />
      </div>
    </section>
  );
}

function Kits({
  orders,
  available,
  purchasing,
  onRefresh
}: {
  orders: NonNullable<Snapshot["kitOrders"]>;
  available: NonNullable<Snapshot["availableKits"]>;
  purchasing: boolean;
  onRefresh: () => void;
}) {
  const [loadingId, setLoadingId] = useState("");
  const [message, setMessage] = useState("");
  const buy = async (kitId: string) => {
    if (loadingId) return;
    setLoadingId(kitId);
    setMessage("");
    try {
      await postRepresentativeAction({
        action: "buy_kit",
        kitId,
        idempotencyKey: crypto.randomUUID()
      });
      const selectedKit = available.find((kit) => kit.id === kitId);
      setMessage(
        selectedKit?.demo
          ? "Pedido demonstrativo criado com pagamento mock identificado."
          : "Pedido criado. O pagamento permanece pendente até um provedor ser disponibilizado."
      );
      onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível criar o pedido.");
    } finally {
      setLoadingId("");
    }
  };
  return (
    <section>
      <PageTitle
        title={purchasing ? "Comprar kit" : "Meus kits"}
        description={
          purchasing
            ? "Somente kits ativos e permitidos para seu nível aparecem aqui."
            : "Acompanhe pagamento, separação e entrega."
        }
      />
      {message && <p className="form-message" role="status">{message}</p>}
      {purchasing && available.length ? (
        <div className="representative-record-grid">
          {available.map((kit) => (
            <article className="representative-card representative-kit-card" key={kit.id}>
              <PackageCheck />
              <small>{kit.requiredForActivation ? "Kit de ativação" : "Kit disponível"}</small>
              <h2>{kit.name}</h2>
              <p>{kit.description}</p>
              <strong>{formatBRL(kit.priceInCents)}</strong>
              {kit.demo && <span className="representative-pill warning">Oferta fictícia · demo</span>}
              <button className="primary-button" disabled={loadingId === kit.id} onClick={() => void buy(kit.id)}>
                {loadingId === kit.id ? <LoaderCircle className="spin" /> : <ShoppingBag />} Solicitar kit
              </button>
            </article>
          ))}
        </div>
      ) : purchasing ? (
        <EmptyState icon={ShoppingBag} title="Nenhum kit disponível" description="A Gerência ainda não publicou uma oferta compatível com seu perfil." />
      ) : orders.length ? (
        <div className="representative-record-grid">
          {orders.map((order) => (
            <article className="representative-card representative-kit-card" key={order.id}>
              <strong>{order.kitName}</strong>
              <span>{order.publicCode}</span>
              <b>{statusLabel(order.status)}</b>
              <small>{formatBRL(order.totalInCents)}</small>
            </article>
          ))}
        </div>
      ) : (
        <div className="representative-empty">
          <PackageCheck />
          <h2>Nenhum kit adquirido</h2>
        </div>
      )}
    </section>
  );
}

function Creatives({ creatives }: { creatives: NonNullable<Snapshot["creatives"]> }) {
  const [favorites, setFavorites] = useState<Set<string>>(
    () => new Set(creatives.filter((creative) => creative.favorite).map((creative) => creative.id))
  );
  const [query, setQuery] = useState("");
  const visible = creatives.filter((creative) =>
    `${creative.title} ${creative.campaign} ${creative.platform}`
      .toLocaleLowerCase("pt-BR")
      .includes(query.toLocaleLowerCase("pt-BR"))
  );
  const toggleFavorite = async (creativeId: string) => {
    const favorite = !favorites.has(creativeId);
    setFavorites((current) => {
      const next = new Set(current);
      if (favorite) next.add(creativeId);
      else next.delete(creativeId);
      return next;
    });
    try {
      await logCreative(creativeId, favorite ? "favorite" : "unfavorite");
    } catch {
      setFavorites((current) => {
        const next = new Set(current);
        if (favorite) next.delete(creativeId);
        else next.add(creativeId);
        return next;
      });
    }
  };
  return (
    <section>
      <PageTitle
        title="Criativos"
        description="Materiais aprovados para seu perfil, nível e região."
      />
      <label className="representative-search">
        <Search />
        <span className="sr-only">Buscar materiais</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por campanha, formato ou canal" />
      </label>
      <div className="creative-grid">
        {visible.length ? (
          visible.map((creative) => (
            <article className="creative-card" key={creative.id}>
              <div className="creative-preview">
                <FileImage />
              </div>
              <small>
                {creative.platform} · {creative.type}
                {creative.demo ? " · demo" : ""}
              </small>
              <h2>{creative.title}</h2>
              <p>{creative.campaign}</p>
              <div>
                <CopyButton
                  value={creative.caption}
                  label="Copiar legenda"
                  event={{ creativeId: creative.id, eventType: "copy" }}
                />
                <button
                  className="icon-button"
                  aria-label={favorites.has(creative.id) ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                  aria-pressed={favorites.has(creative.id)}
                  onClick={() => void toggleFavorite(creative.id)}
                >
                  <Heart fill={favorites.has(creative.id) ? "currentColor" : "none"} />
                </button>
                <button className="icon-button" aria-label="Registrar compartilhamento" onClick={() => void logCreative(creative.id, "share")}><Share2 /></button>
                {creative.signedUrl ? (
                  <a
                    className="icon-button"
                    aria-label="Baixar"
                    href={creative.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => void logCreative(creative.id, "download")}
                  >
                    <Download />
                  </a>
                ) : (
                  <button
                    className="icon-button"
                    aria-label="Baixar"
                    disabled
                    title="Arquivo não anexado"
                  >
                    <Download />
                  </button>
                )}
              </div>
            </article>
          ))
        ) : (
          <div className="representative-empty">
            <FileImage />
            <h2>Nenhum material publicado</h2>
          </div>
        )}
      </div>
    </section>
  );
}

function PageTitle({ title, description }: { title: string; description: string }) {
  return (
    <header className="representative-page-title">
      <div>
        <p className="eyebrow">Portal da representante</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article>
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}
function EmptyState({
  icon: Icon,
  title,
  description
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="representative-empty">
      <Icon />
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
function RecordList({
  title,
  rows,
  empty
}: {
  title: string;
  rows: Array<{ id: string; title: string; detail: string; meta: string }>;
  empty: string;
}) {
  return (
    <section className="representative-card representative-record-list">
      <h2>{title}</h2>
      {rows.length ? (
        rows.map((row) => (
          <article key={row.id}>
            <div>
              <strong>{row.title}</strong>
              <span>{row.detail}</span>
            </div>
            <small>{row.meta}</small>
          </article>
        ))
      ) : (
        <p className="quiet-state">{empty}</p>
      )}
    </section>
  );
}
function PrivateFileList({
  title,
  rows,
  empty
}: {
  title: string;
  rows: Array<{
    id: string;
    title: string;
    detail: string;
    meta: string;
    signedUrl: string | null;
  }>;
  empty: string;
}) {
  return (
    <section className="representative-card representative-record-list">
      <h2>{title}</h2>
      {rows.length ? (
        rows.map((row) => (
          <article key={row.id}>
            <div>
              <strong>{row.title}</strong>
              <span>{row.detail}</span>
              <small>{row.meta}</small>
            </div>
            {row.signedUrl ? (
              <a className="secondary-button" href={row.signedUrl} target="_blank" rel="noreferrer">
                <Download /> Baixar
              </a>
            ) : (
              <span className="representative-pill">Arquivo indisponível</span>
            )}
          </article>
        ))
      ) : (
        <p className="quiet-state">{empty}</p>
      )}
    </section>
  );
}
function Pagination({
  pagination,
  onPageChange
}: {
  pagination: { page: number; pageSize: number; total: number };
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  if (totalPages <= 1) return null;
  return (
    <nav className="representative-pagination" aria-label="Paginação">
      <button
        className="secondary-button"
        disabled={pagination.page <= 1}
        onClick={() => onPageChange(pagination.page - 1)}
      >
        Anterior
      </button>
      <span>Página {pagination.page} de {totalPages}</span>
      <button
        className="secondary-button"
        disabled={pagination.page >= totalPages}
        onClick={() => onPageChange(pagination.page + 1)}
      >
        Próxima
      </button>
    </nav>
  );
}
function RuleFacts({
  values,
  empty
}: {
  values: Record<string, unknown>;
  empty: string;
}) {
  const entries = Object.entries(values).filter(
    ([, value]) => ["string", "number", "boolean"].includes(typeof value)
  );
  if (!entries.length) return <p className="quiet-state">{empty}</p>;
  return (
    <dl className="representative-rule-facts">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{humanizeCode(key)}</dt>
          <dd>{formatRuleValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
function CopyButton({
  value,
  label,
  event
}: {
  value: string;
  label: string;
  event?: { creativeId: string; eventType: string };
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    if (event) await logCreative(event.creativeId, event.eventType);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button className="secondary-button" onClick={() => void copy()}>
      {copied ? <Check /> : <Copy />} {copied ? "Copiado" : label}
    </button>
  );
}
const logCreative = async (creativeId: string, eventType: string) => {
  await postRepresentativeAction({ action: "creative_event", creativeId, eventType });
};
const postRepresentativeAction = async (body: Record<string, unknown>) => {
  const response = await fetch("/api/representatives", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(result.message ?? "Não foi possível concluir a ação.");
  return result;
};
const windowOrigin = () =>
  typeof window === "undefined" ? "https://curtiz.com.br" : window.location.origin;
const referralLink = (code: string) => `${process.env.NEXT_PUBLIC_STORE_URL ?? ""}/indicar/${code}`;
const formatDate = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value))
    : "Data não informada";
const formatDateTime = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo"
      }).format(new Date(value))
    : "Data não informada";
const formatPeriod = (start: string, end: string) => `${formatDate(start)} a ${formatDate(end)}`;
const humanizeCode = (value: string) =>
  value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/gu, (letter) => letter.toLocaleUpperCase("pt-BR"));
const formatRuleValue = (value: unknown) => {
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") return new Intl.NumberFormat("pt-BR").format(value);
  return String(value);
};
const movementLabel = (reason: string) =>
  ({
    representative_sale: "Venda registrada",
    sale_cancellation: "Cancelamento de venda",
    kit_delivery: "Recebimento de kit",
    return: "Devolução",
    loss: "Perda",
    damage: "Avaria",
    adjustment: "Ajuste"
  })[reason] ?? humanizeCode(reason);
const localDateTimeNow = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
const statusLabel = (status: string) =>
  ({
    approved_waiting_kit: "Aguardando kit",
    active: "Ativa",
    inactive: "Inativa",
    unqualified: "Não qualificada",
    suspended: "Suspensa",
    cancelled: "Cancelada",
    confirmed: "Confirmada",
    pending_payment: "Aguardando pagamento",
    paid: "Pago",
    separating: "Em separação",
    shipped: "Enviado",
    delivered: "Entregue",
    submitted: "Enviada",
    under_review: "Em análise",
    documents_pending: "Correção solicitada",
    approved: "Aprovada",
    rejected: "Encerrada",
    pending: "Pendente",
    qualified: "Qualificada",
    payable: "Disponível",
    processing: "Em processamento",
    failed: "Falhou",
    refunded: "Reembolsada",
    reversed: "Estornada",
    available: "Disponível",
    started: "Em andamento",
    completed: "Concluído",
    expired: "Expirado"
  })[status] ?? status.replaceAll("_", " ");
