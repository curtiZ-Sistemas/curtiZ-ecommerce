"use client";

import { formatBRL } from "@curtiz/domain";
import {
  BadgeDollarSign,
  Boxes,
  BriefcaseBusiness,
  Check,
  ClipboardList,
  Copy,
  Download,
  FileImage,
  Goal,
  House,
  LifeBuoy,
  Link2,
  LoaderCircle,
  Menu,
  PackageCheck,
  ReceiptText,
  Share2,
  ShoppingBag,
  UserRound,
  UsersRound,
  X
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { readString } from "@/lib/unknown-data";

type Snapshot = {
  demo: boolean;
  representative: null | {
    publicCode: string;
    referralCode: string;
    status: string;
    levelName: string | null;
    regionCode: string;
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
  creatives?: Array<{
    id: string;
    title: string;
    campaign: string;
    type: string;
    platform: string;
    caption: string;
    signedUrl?: string | null;
    demo?: true;
  }>;
};

const navigation = [
  ["Visão geral", "", House],
  ["Meu perfil", "perfil", UserRound],
  ["Meu nível", "nivel", BriefcaseBusiness],
  ["Metas", "metas", Goal],
  ["Meus kits", "kits", PackageCheck],
  ["Comprar kit", "comprar-kit", ShoppingBag],
  ["Meu estoque", "estoque", Boxes],
  ["Registrar venda", "registrar-venda", ReceiptText],
  ["Minhas vendas", "vendas", ClipboardList],
  ["Link de indicação", "indicacao", Link2],
  ["Minha equipe", "equipe", UsersRound],
  ["Comissões", "comissoes", BadgeDollarSign],
  ["Criativos", "criativos", FileImage],
  ["Atendimento", "atendimento", LifeBuoy]
] as const;

export function RepresentativePortal({ section }: { section: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const load = () => {
    setError("");
    void fetch("/api/representatives", { cache: "no-store" })
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
          ...(creative.demo === true ? { demo: true as const } : {})
        }));
        return result;
      })
      .then((result) => result && setSnapshot(result))
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Falha inesperada.")
      );
  };

  useEffect(load, [section]);

  if (error)
    return (
      <main className="container page-shell">
        <div className="error-state">
          <h1>Portal indisponível</h1>
          <p>{error}</p>
          <button className="primary-button" onClick={load}>
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
        <Link className="representative-customer-link" href="/minha-conta">
          <UserRound /> Voltar à área de cliente
        </Link>
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
          <PortalSection section={section} snapshot={snapshot} onRefresh={load} />
        </main>
      </div>
    </div>
  );
}

function PortalSection({
  section,
  snapshot,
  onRefresh
}: {
  section: string;
  snapshot: Snapshot;
  onRefresh: () => void;
}) {
  const representative = snapshot.representative!;
  if (!section) return <Overview snapshot={snapshot} />;
  if (section === "registrar-venda")
    return <SaleForm inventory={snapshot.inventory ?? []} onSaved={onRefresh} />;
  if (section === "vendas") return <Sales sales={snapshot.sales ?? []} />;
  if (section === "criativos") return <Creatives creatives={snapshot.creatives ?? []} />;
  if (section === "indicacao") return <Referral referralCode={representative.referralCode} />;
  if (section === "kits" || section === "comprar-kit")
    return <Kits orders={snapshot.kitOrders ?? []} purchasing={section === "comprar-kit"} />;
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
  const emptyCopy: Record<string, [string, string]> = {
    perfil: ["Meu perfil profissional", "Dados comerciais e região da sua atuação."],
    nivel: [
      "Meu nível",
      representative.levelName
        ? `Nível atual: ${representative.levelName}.`
        : "Nenhum nível foi atribuído pelas regras vigentes."
    ],
    metas: ["Metas", "Nenhuma meta configurada para o período atual."],
    estoque: [
      "Meu estoque",
      "Os itens recebidos em kits e movimentos confirmados aparecerão aqui."
    ],
    equipe: ["Minha equipe", "Sua rede aparecerá após indicações válidas e aprovadas."],
    comissoes: [
      "Comissões",
      "Lançamentos aparecem somente após venda paga, qualificada e processada."
    ]
  };
  const [title, description] = emptyCopy[section] ?? [
    "Área profissional",
    "Conteúdo não disponível para este perfil."
  ];
  return (
    <section>
      <PageTitle title={title} description={description} />
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
        <Metric label="Status comercial" value={statusLabel(representative.status)} />
        <Metric label="Vendas registradas" value={String(sales.length)} />
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
          <p className="quiet-state">
            Ações são exibidas quando uma regra, correção ou prazo real é atribuído.
          </p>
        </section>
      </div>
    </>
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
    const rawVariantId = form.get("variantId");
    const variantId = typeof rawVariantId === "string" ? rawVariantId : "";
    const quantity = Number(form.get("quantity"));
    const rawReference = form.get("reference");
    const customerReference = typeof rawReference === "string" ? rawReference.trim() : "";
    try {
      const response = await fetch("/api/representatives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "record_sale",
          idempotencyKey: crypto.randomUUID(),
          items: [{ variantId, quantity }],
          ...(customerReference ? { customerReference } : {})
        })
      });
      const result = (await response.json()) as { message?: string; publicCode?: string };
      if (!response.ok) throw new Error(result.message ?? "Não foi possível registrar.");
      setMessage(`Venda ${result.publicCode ?? ""} registrada.`);
      event.currentTarget.reset();
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
        <label className="field">
          <span>Produto e variação</span>
          <select name="variantId" required defaultValue="">
            <option value="" disabled>
              Selecione um item do estoque
            </option>
            {inventory
              .filter((item) => item.quantity > 0)
              .map((item) => (
                <option value={item.variantId} key={item.variantId}>
                  {item.productName} · {item.color} · {item.size} · {formatBRL(item.priceInCents)} · {item.quantity} un.
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Quantidade</span>
          <input name="quantity" type="number" min={1} max={99} step={1} defaultValue={1} required />
        </label>
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
  compact = false
}: {
  sales: NonNullable<Snapshot["sales"]>;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "representative-sales compact" : "representative-sales"}>
      {!compact && (
        <PageTitle title="Minhas vendas" description="Histórico de registros confirmados." />
      )}
      {sales.length ? (
        sales.map((sale) => (
          <article key={sale.id}>
            <div>
              <strong>{sale.publicCode}</strong>
              <small>{new Intl.DateTimeFormat("pt-BR").format(new Date(sale.soldAt))}</small>
            </div>
            <span>{statusLabel(sale.status)}</span>
            <b>{formatBRL(sale.totalInCents)}</b>
          </article>
        ))
      ) : (
        <div className="representative-empty">
          <ReceiptText />
          <h2>Nenhuma venda registrada</h2>
        </div>
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
  purchasing
}: {
  orders: NonNullable<Snapshot["kitOrders"]>;
  purchasing: boolean;
}) {
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
      {purchasing ? (
        <div className="representative-empty">
          <ShoppingBag />
          <h2>Nenhum kit disponível</h2>
          <p>A Gerência ainda não publicou uma oferta compatível com seu perfil.</p>
        </div>
      ) : orders.length ? (
        orders.map((order) => (
          <article className="representative-card" key={order.id}>
            <strong>{order.kitName}</strong>
            <span>{order.publicCode}</span>
            <b>{statusLabel(order.status)}</b>
          </article>
        ))
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
  return (
    <section>
      <PageTitle
        title="Criativos"
        description="Materiais aprovados para seu perfil, nível e região."
      />
      <div className="creative-grid">
        {creatives.length ? (
          creatives.map((creative) => (
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
                  aria-label="Compartilhar"
                  onClick={() => void logCreative(creative.id, "share")}
                >
                  <Share2 />
                </button>
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
  await fetch("/api/representatives", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "creative_event", creativeId, eventType })
  });
};
const windowOrigin = () =>
  typeof window === "undefined" ? "https://curtiz.com.br" : window.location.origin;
const referralLink = (code: string) => `${process.env.NEXT_PUBLIC_STORE_URL ?? ""}/indicar/${code}`;
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
    rejected: "Encerrada"
  })[status] ?? status.replaceAll("_", " ");
