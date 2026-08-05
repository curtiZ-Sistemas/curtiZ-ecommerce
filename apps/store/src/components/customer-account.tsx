"use client";

import { formatBRL, type Product } from "@curtiz/domain";
import {
  Bell,
  ChevronRight,
  CircleUserRound,
  ClipboardCheck,
  Heart,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  PackageCheck,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Star,
  Tag,
  Truck,
  UserRoundCheck
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useMemo,
  useState,
  useTransition
} from "react";
import type {
  CustomerAccountSnapshot,
  CustomerAddress,
  CustomerFavorite,
  CustomerOrder,
  PendingReview
} from "../lib/customer-account-types";
import { useCart } from "./cart-provider";
import { useFavorites } from "./favorites-provider";
import { LogoutButton } from "./logout-button";
import { SupportCenter } from "./support-center";
import { FavoritesPanel } from "./favorites-panel";
import { customerStatusLabel } from "../lib/customer-account-presentation";

type Props = {
  snapshot: CustomerAccountSnapshot;
  section: string;
  selectedOrderCode: string;
  startNewSupport: boolean;
  signupComplete: boolean;
};

const nav = [
  ["Visão geral", "visao-geral", ShoppingBag],
  ["Perfil", "perfil", CircleUserRound],
  ["Pedidos", "pedidos", PackageCheck],
  ["Favoritos", "favoritos", Heart],
  ["Avaliações", "avaliacoes", Star],
  ["Cupons", "cupons", Tag],
  ["Endereços", "enderecos", MapPin],
  ["Segurança", "seguranca", ShieldCheck],
  ["Trocas", "trocas", RotateCcw],
  ["Representante", "representante", UserRoundCheck],
  ["Notificações", "notificacoes", Bell],
  ["Atendimento", "atendimento", ClipboardCheck]
] as const;

const formatDate = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "medium",
        timeZone: "America/Sao_Paulo"
      }).format(new Date(value))
    : "Não informado";

const addressValue = (address: Record<string, unknown>, key: string) => {
  const value = address[key];
  return typeof value === "string" ? value : "";
};

export function CustomerAccount({
  snapshot,
  section,
  selectedOrderCode,
  startNewSupport,
  signupComplete
}: Props) {
  const activeSection = nav.some(([, slug]) => slug === section) ? section : "visao-geral";
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const runAction = async (
    body: Record<string, unknown>,
    successMessage: string,
    files?: FileList | null
  ) => {
    if (pending) return null;
    setMessage("");
    setError("");
    const response = await fetch("/api/customer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = (await response.json().catch(() => ({}))) as {
      message?: string;
      simulated?: boolean;
      data?: { id?: string };
    };
    if (!response.ok) {
      setError(result.message ?? "Não foi possível concluir a ação.");
      return null;
    }
    const reviewId = result.data?.id;
    if (files?.length && reviewId) {
      for (const file of Array.from(files).slice(0, 4)) {
        const form = new FormData();
        form.set("reviewId", reviewId);
        form.set("file", file);
        const upload = await fetch("/api/customer/review-media", {
          method: "POST",
          body: form
        });
        if (!upload.ok) {
          const uploadResult = (await upload.json().catch(() => ({}))) as {
            message?: string;
          };
          setError(
            uploadResult.message ??
              "A avaliação foi salva, mas um arquivo não pôde ser enviado."
          );
          return result;
        }
      }
    }
    setMessage(result.simulated ? result.message ?? successMessage : successMessage);
    startTransition(() => router.refresh());
    return result;
  };

  const uploadAvatar = async (file: File) => {
    if (pending) return;
    setMessage("");
    setError("");
    const form = new FormData();
    form.set("file", file);
    const response = await fetch("/api/customer/avatar", {
      method: "POST",
      body: form
    });
    const result = (await response.json().catch(() => ({}))) as {
      message?: string;
      simulated?: boolean;
    };
    if (!response.ok) {
      setError(result.message ?? "Não foi possível atualizar o avatar.");
      return;
    }
    setMessage(result.message ?? "Avatar atualizado.");
    startTransition(() => router.refresh());
  };

  return (
    <main className="container page-shell customer-account-page">
      <header className="customer-account-header">
        <div className="customer-profile-heading">
          <span className="customer-avatar" aria-hidden="true">
            {snapshot.profile.avatarUrl ? (
              <Image
                src={snapshot.profile.avatarUrl}
                alt=""
                fill
                sizes="64px"
                unoptimized
              />
            ) : (
              snapshot.profile.fullName.slice(0, 1).toUpperCase()
            )}
          </span>
          <div>
            <p className="eyebrow">Área do cliente</p>
            <h1>Olá, {snapshot.profile.fullName.split(" ")[0]}</h1>
            <p>Gerencie sua conta, compras e preferências em um só lugar.</p>
          </div>
        </div>
        <Link className="secondary-button compact-button" href="/produtos">
          Continuar comprando
        </Link>
      </header>

      {(snapshot.warning || signupComplete) && (
        <p className="customer-account-notice" role="status">
          {signupComplete
            ? "Cadastro concluído. Seu perfil está pronto para ser completado."
            : snapshot.warning}
        </p>
      )}
      {(message || error) && (
        <p
          className={`customer-action-message ${error ? "is-error" : "is-success"}`}
          role={error ? "alert" : "status"}
        >
          {pending && <LoaderCircle className="spin" aria-hidden="true" />}
          {error || message}
        </p>
      )}

      <div className="customer-account-layout">
        <nav className="customer-account-nav" aria-label="Menu da área do cliente">
          {nav.map(([label, slug, Icon]) => (
            <Link
              key={slug}
              href={slug === "visao-geral" ? "/minha-conta" : `/minha-conta/${slug}`}
              aria-current={activeSection === slug ? "page" : undefined}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
          <LogoutButton className="customer-account-logout" />
        </nav>

        <section className="customer-account-content" aria-live="polite">
          {activeSection === "visao-geral" && <Overview snapshot={snapshot} />}
          {activeSection === "perfil" && (
            <Profile
              snapshot={snapshot}
              runAction={runAction}
              uploadAvatar={uploadAvatar}
              pending={pending}
            />
          )}
          {activeSection === "pedidos" && (
            <Orders
              orders={snapshot.orders}
              selectedOrderCode={selectedOrderCode}
              runAction={runAction}
              pending={pending}
            />
          )}
          {activeSection === "favoritos" && (
            snapshot.demo ? (
              <div className="customer-section-stack">
                <SectionTitle
                  eyebrow="Favoritos"
                  title="Seus produtos favoritos"
                  description="Esta lista permanece disponível neste dispositivo."
                />
                <FavoritesPanel />
              </div>
            ) : (
              <Favorites
                favorites={snapshot.favorites}
                runAction={runAction}
                pending={pending}
              />
            )
          )}
          {activeSection === "avaliacoes" && (
            <Reviews
              pendingReviews={snapshot.pendingReviews}
              reviews={snapshot.reviews}
              runAction={runAction}
              pending={pending}
            />
          )}
          {activeSection === "cupons" && <Coupons coupons={snapshot.coupons} />}
          {activeSection === "enderecos" && (
            <Addresses
              addresses={snapshot.addresses}
              profileName={snapshot.profile.fullName}
              runAction={runAction}
              pending={pending}
            />
          )}
          {activeSection === "seguranca" && <Security snapshot={snapshot} />}
          {activeSection === "trocas" && (
            <Returns
              returns={snapshot.returns}
              orders={snapshot.orders}
              runAction={runAction}
              pending={pending}
            />
          )}
          {activeSection === "representante" && (
            <Representative representative={snapshot.representative} />
          )}
          {activeSection === "notificacoes" && (
            <Notifications
              notifications={snapshot.notifications}
              runAction={runAction}
              pending={pending}
            />
          )}
          {activeSection === "atendimento" && (
            <SupportCenter accountMode startNew={startNewSupport} />
          )}
        </section>
      </div>
    </main>
  );
}

function SectionTitle({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="customer-section-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

function Overview({ snapshot }: { snapshot: CustomerAccountSnapshot }) {
  const localFavorites = useFavorites();
  const inProgress = snapshot.orders.filter((order) =>
    [
      "pending_payment",
      "payment_approved",
      "processing",
      "picking",
      "ready_to_ship",
      "shipped"
    ].includes(order.status)
  ).length;
  const delivered = snapshot.orders.filter((order) => order.status === "delivered").length;
  const unread = snapshot.notifications.filter((item) => !item.readAt).length;
  const cards = [
    ["Pedidos em andamento", inProgress, "pedidos", Truck],
    ["Pedidos entregues", delivered, "pedidos", PackageCheck],
    ["Favoritos", snapshot.demo && localFavorites.hydrated ? localFavorites.products.length : snapshot.favorites.length, "favoritos", Heart],
    ["Avaliações pendentes", snapshot.pendingReviews.length, "avaliacoes", Star],
    ["Trocas abertas", snapshot.returns.filter((item) => !["completed", "refunded", "exchange_sent", "rejected", "cancelled"].includes(item.status)).length, "trocas", RotateCcw],
    ["Notificações novas", unread, "notificacoes", Bell]
  ] as const;
  const latestOrder = snapshot.orders[0];
  return (
    <div className="customer-section-stack">
      <SectionTitle
        eyebrow="Visão geral"
        title="Sua conta em resumo"
        description="Informações atualizadas a partir da sua conta Curtiz."
      />
      <div className="customer-metric-grid">
        {cards.map(([label, value, slug, Icon]) => (
          <Link className="customer-metric-card" href={`/minha-conta/${slug}`} key={label}>
            <span><Icon aria-hidden="true" /></span>
            <strong>{value}</strong>
            <small>{label}</small>
            <ChevronRight aria-hidden="true" />
          </Link>
        ))}
      </div>
      <div className="customer-overview-grid">
        <article className="customer-panel">
          <div className="customer-panel-heading">
            <h3>Último pedido</h3>
            <Link href="/minha-conta/pedidos">Ver pedidos</Link>
          </div>
          {latestOrder ? (
            <Link
              className="customer-latest-order"
              href={`/minha-conta/pedidos?pedido=${encodeURIComponent(latestOrder.publicCode)}`}
            >
              <div>
                <strong>#{latestOrder.publicCode}</strong>
                <span>{formatDate(latestOrder.placedAt)}</span>
              </div>
              <div>
                <span className={`customer-status status-${latestOrder.status}`}>
                  {customerStatusLabel(latestOrder.status)}
                </span>
                <strong>{formatBRL(latestOrder.totalInCents)}</strong>
              </div>
            </Link>
          ) : (
            <EmptyState
              icon={<ShoppingBag />}
              title="Você ainda não fez pedidos"
              text="Quando sua primeira compra for concluída, ela aparecerá aqui."
              action={<Link className="primary-button" href="/produtos">Explorar produtos</Link>}
            />
          )}
        </article>
        <article className="customer-panel">
          <div className="customer-panel-heading">
            <h3>Atalhos úteis</h3>
          </div>
          <div className="customer-shortcuts">
            <Link href="/minha-conta/enderecos"><MapPin />Gerenciar endereços<ChevronRight /></Link>
            <Link href="/minha-conta/seguranca"><ShieldCheck />Segurança da conta<ChevronRight /></Link>
            <Link href="/minha-conta/representante"><UserRoundCheck />Representante Curtiz<ChevronRight /></Link>
            <Link href="/minha-conta/atendimento?new=1"><ClipboardCheck />Falar com atendimento<ChevronRight /></Link>
          </div>
        </article>
      </div>
      <article className="customer-panel customer-representative-summary">
        <div>
          <p className="eyebrow">Representante Curtiz</p>
          <h3>
            {snapshot.representative.approved
              ? "Seu Portal do Representante está disponível"
              : snapshot.representative.applicationStatus
                ? `Solicitação ${customerStatusLabel(snapshot.representative.applicationStatus).toLowerCase()}`
                : "Conheça o programa de representantes"}
          </h3>
        </div>
        <Link className="secondary-button" href="/minha-conta/representante">
          Consultar
        </Link>
      </article>
    </div>
  );
}

type RunAction = (
  body: Record<string, unknown>,
  successMessage: string,
  files?: FileList | null
) => Promise<unknown>;

function Profile({
  snapshot,
  runAction,
  uploadAvatar,
  pending
}: {
  snapshot: CustomerAccountSnapshot;
  runAction: RunAction;
  uploadAvatar: (file: File) => Promise<void>;
  pending: boolean;
}) {
  const address = snapshot.addresses.find((item) => item.isDefault);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void runAction(
      {
        action: "profile_update",
        fullName: form.get("fullName"),
        phone: form.get("phone"),
        birthDate: form.get("birthDate")
      },
      "Dados pessoais atualizados."
    );
  };
  return (
    <div className="customer-section-stack">
      <SectionTitle
        eyebrow="Perfil"
        title="Dados pessoais"
        description="Mantenha seus dados atualizados para agilizar compras e entregas."
      />
      <form className="customer-panel customer-form" onSubmit={submit}>
        <div className="customer-profile-card">
          <div className="customer-avatar-control">
            <span className="customer-avatar large" aria-hidden="true">
              {snapshot.profile.avatarUrl ? (
                <Image
                  src={snapshot.profile.avatarUrl}
                  alt=""
                  fill
                  sizes="68px"
                  unoptimized
                />
              ) : (
                snapshot.profile.fullName.slice(0, 1).toUpperCase()
              )}
            </span>
            <label className="customer-avatar-upload">
              <span>Alterar foto</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={pending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadAvatar(file);
                }}
              />
            </label>
          </div>
          <div>
            <strong>{snapshot.profile.fullName}</strong>
            <span>{snapshot.profile.email}</span>
            <small>Conta criada em {formatDate(snapshot.profile.createdAt)}</small>
          </div>
        </div>
        <div className="customer-form-grid">
          <label className="customer-field">
            <span>Nome completo</span>
            <input name="fullName" defaultValue={snapshot.profile.fullName} minLength={3} required />
          </label>
          <label className="customer-field">
            <span>E-mail</span>
            <input value={snapshot.profile.email} readOnly aria-describedby="email-help" />
            <small id="email-help">O e-mail de acesso é protegido pelo Auth.</small>
          </label>
          <label className="customer-field">
            <span>Telefone</span>
            <input name="phone" defaultValue={snapshot.profile.phone} inputMode="tel" maxLength={24} />
          </label>
          <label className="customer-field">
            <span>Data de nascimento</span>
            <input name="birthDate" type="date" defaultValue={snapshot.profile.birthDate} />
          </label>
          <div className="customer-field">
            <span>CPF</span>
            <div className="customer-readonly">
              {snapshot.profile.cpfLastFour
                ? `•••.•••.•••-${snapshot.profile.cpfLastFour}`
                : "Não informado"}
            </div>
          </div>
          <div className="customer-field">
            <span>Endereço principal</span>
            <div className="customer-readonly">
              {address
                ? `${address.street}, ${address.number} · ${address.city}/${address.state}`
                : "Nenhum endereço principal"}
            </div>
          </div>
        </div>
        <div className="customer-form-actions">
          <button className="primary-button" type="submit" disabled={pending}>
            {pending && <LoaderCircle className="spin" />}
            Salvar alterações
          </button>
          <Link className="secondary-button" href="/minha-conta/seguranca">
            Alterar senha
          </Link>
        </div>
      </form>
    </div>
  );
}

function Orders({
  orders,
  selectedOrderCode,
  runAction,
  pending
}: {
  orders: CustomerOrder[];
  selectedOrderCode: string;
  runAction: RunAction;
  pending: boolean;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const selected = orders.find((order) => order.publicCode === selectedOrderCode);
  const visible = useMemo(
    () =>
      orders.filter(
        (order) =>
          (filter === "all" || order.status === filter) &&
          (!search ||
            order.publicCode.toLowerCase().includes(search.toLowerCase()) ||
            order.items.some((item) =>
              item.productName.toLowerCase().includes(search.toLowerCase())
            ))
      ),
    [filter, orders, search]
  );

  if (selected) {
    return (
      <OrderDetails order={selected} runAction={runAction} pending={pending} />
    );
  }
  return (
    <div className="customer-section-stack">
      <SectionTitle
        eyebrow="Pedidos"
        title="Meus pedidos"
        description="Acompanhe pagamentos, separação, entrega e histórico."
      />
      <div className="customer-order-filters">
        <label>
          <Search aria-hidden="true" />
          <span className="sr-only">Buscar pedido</span>
          <input
            type="search"
            placeholder="Buscar por pedido ou produto"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filtrar por status">
          <option value="all">Todos os status</option>
          <option value="pending_payment">Aguardando pagamento</option>
          <option value="processing">Em preparação</option>
          <option value="shipped">Enviado</option>
          <option value="delivered">Entregue</option>
          <option value="cancelled">Cancelado</option>
        </select>
      </div>
      {visible.length ? (
        <div className="customer-order-list">
          {visible.map((order) => (
            <article className="customer-order-card" key={order.id}>
              <div className="customer-order-head">
                <div>
                  <small>Pedido</small>
                  <strong>#{order.publicCode}</strong>
                  <span>{formatDate(order.placedAt)}</span>
                </div>
                <span className={`customer-status status-${order.status}`}>
                  {customerStatusLabel(order.status)}
                </span>
              </div>
              <div className="customer-order-products">
                {order.items.slice(0, 3).map((item) => (
                  <div key={item.id}>
                    {item.image ? (
                      <Image src={item.image} alt="" width={64} height={64} />
                    ) : (
                      <ShoppingBag aria-hidden="true" />
                    )}
                    <span>{item.productName}</span>
                  </div>
                ))}
              </div>
              <div className="customer-order-foot">
                <span>{order.items.reduce((sum, item) => sum + item.quantity, 0)} item(ns)</span>
                <strong>{formatBRL(order.totalInCents)}</strong>
                <Link
                  className="secondary-button compact-button"
                  href={`/minha-conta/pedidos?pedido=${encodeURIComponent(order.publicCode)}`}
                >
                  Ver detalhes
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<PackageCheck />}
          title={orders.length ? "Nenhum pedido encontrado" : "Você ainda não fez pedidos"}
          text={orders.length ? "Ajuste a busca ou os filtros." : "Seus pedidos aparecerão aqui."}
          action={!orders.length ? <Link className="primary-button" href="/produtos">Explorar produtos</Link> : undefined}
        />
      )}
    </div>
  );
}

function OrderDetails({
  order,
  runAction,
  pending
}: {
  order: CustomerOrder;
  runAction: RunAction;
  pending: boolean;
}) {
  const { add } = useCart();
  const canCancel = ["pending_payment", "payment_approved", "processing"].includes(order.status);
  const repeat = () => {
    order.items.forEach((item) => {
      if (!item.variantId || !item.slug) return;
      const product: Product = {
        id: item.productId,
        slug: item.slug,
        name: item.productName,
        category: "Masculino",
        description: "",
        priceInCents: item.unitPriceInCents,
        rating: 0,
        reviews: 0,
        colors: [item.color],
        sizes: [item.size],
        image: item.image,
        stock: 10
      };
      add(product, item.color, item.size, {
        variantId: item.variantId,
        unitPriceInCents: item.unitPriceInCents,
        stock: 10,
        image: item.image
      });
    });
  };
  const address = order.address;
  return (
    <div className="customer-section-stack">
      <SectionTitle
        eyebrow="Detalhes do pedido"
        title={`Pedido #${order.publicCode}`}
        description={`Realizado em ${formatDate(order.placedAt)}`}
        action={<Link className="secondary-button compact-button" href="/minha-conta/pedidos">Voltar</Link>}
      />
      <article className="customer-panel customer-tracking">
        <div className="customer-panel-heading">
          <h3>Acompanhamento</h3>
          <span className={`customer-status status-${order.status}`}>{customerStatusLabel(order.status)}</span>
        </div>
        <ol>
          {(order.shipment?.events.length
            ? order.shipment.events
            : order.history
          ).map((event) => (
            <li key={event.id}>
              <span aria-hidden="true" />
              <div>
                <strong>{customerStatusLabel("status" in event ? event.status : "")}</strong>
                <p>{"description" in event ? event.description : event.reason}</p>
                <small>{formatDate("occurredAt" in event ? event.occurredAt : event.createdAt)}</small>
              </div>
            </li>
          ))}
        </ol>
        {order.shipment?.trackingCode && (
          <p className="customer-tracking-code">
            Código de rastreio: <strong>{order.shipment.trackingCode}</strong>
          </p>
        )}
      </article>
      <article className="customer-panel">
        <h3>Itens do pedido</h3>
        <div className="customer-order-item-list">
          {order.items.map((item) => (
            <div className="customer-order-item" key={item.id}>
              <div className="customer-order-item-image">
                {item.image ? <Image src={item.image} alt="" fill sizes="80px" /> : <ShoppingBag />}
              </div>
              <div>
                <strong>{item.productName}</strong>
                <span>{item.color} · {item.size} · SKU {item.sku}</span>
                <small>Quantidade: {item.quantity}</small>
              </div>
              <strong>{formatBRL(item.totalInCents)}</strong>
            </div>
          ))}
        </div>
      </article>
      <div className="customer-detail-grid">
        <article className="customer-panel">
          <h3>Entrega</h3>
          <p>
            {addressValue(address, "street")}, {addressValue(address, "number")}
            <br />
            {addressValue(address, "district")} · {addressValue(address, "city")}/
            {addressValue(address, "state")}
            <br />
            CEP {addressValue(address, "postal_code")}
          </p>
          {order.shipment && (
            <small>{order.shipment.service} · {customerStatusLabel(order.shipment.status)}</small>
          )}
        </article>
        <article className="customer-panel">
          <h3>Pagamento</h3>
          <p>{order.payment?.method || order.payment?.provider || "Não informado"}</p>
          <span className="customer-status">{customerStatusLabel(order.paymentStatus)}</span>
        </article>
        <article className="customer-panel customer-order-totals">
          <h3>Resumo</h3>
          <p><span>Subtotal</span><strong>{formatBRL(order.subtotalInCents)}</strong></p>
          <p><span>Descontos</span><strong>- {formatBRL(order.discountInCents)}</strong></p>
          <p><span>Frete</span><strong>{formatBRL(order.shippingInCents)}</strong></p>
          <p className="total"><span>Total</span><strong>{formatBRL(order.totalInCents)}</strong></p>
        </article>
      </div>
      <div className="customer-form-actions">
        <button className="primary-button" type="button" onClick={repeat}>Comprar novamente</button>
        {canCancel && (
          <button
            className="secondary-button"
            type="button"
            disabled={pending}
            onClick={() => void runAction({ action: "order_cancel", orderId: order.id }, "Solicitação de cancelamento enviada.")}
          >
            Solicitar cancelamento
          </button>
        )}
        <Link className="secondary-button" href={`/minha-conta/atendimento?new=1&pedido=${encodeURIComponent(order.publicCode)}`}>
          Preciso de ajuda
        </Link>
      </div>
    </div>
  );
}

function Favorites({
  favorites,
  runAction,
  pending
}: {
  favorites: CustomerFavorite[];
  runAction: RunAction;
  pending: boolean;
}) {
  const { add } = useCart();
  const localFavorites = useFavorites();
  if (!favorites.length) {
    return (
      <div className="customer-section-stack">
        <SectionTitle eyebrow="Favoritos" title="Seus produtos favoritos" description="Preços e disponibilidade são verificados em tempo real." />
        <EmptyState icon={<Heart />} title="Sua lista está vazia" text="Salve produtos para encontrá-los facilmente depois." action={<Link className="primary-button" href="/produtos">Ver produtos</Link>} />
      </div>
    );
  }
  return (
    <div className="customer-section-stack">
      <SectionTitle eyebrow="Favoritos" title="Seus produtos favoritos" description="Preços e disponibilidade são verificados em tempo real." />
      <div className="customer-favorite-grid">
        {favorites.map((favorite) => (
          <article className="customer-favorite-card" key={favorite.productId}>
            <Link href={`/produto/${favorite.slug}`} className="customer-favorite-image">
              {favorite.image ? <Image src={favorite.image} alt="" fill sizes="(max-width: 600px) 50vw, 220px" /> : <ShoppingBag />}
              {!favorite.available && <span>Indisponível</span>}
            </Link>
            <div>
              <Link href={`/produto/${favorite.slug}`}><h3>{favorite.name}</h3></Link>
              <strong>{formatBRL(favorite.priceInCents)}</strong>
              {!favorite.available && <small>Indisponível</small>}
            </div>
            <div className="customer-favorite-actions">
              <button
                className="primary-button"
                type="button"
                disabled={!favorite.available}
                onClick={() => {
                  const product: Product = {
                    id: favorite.productId,
                    slug: favorite.slug,
                    name: favorite.name,
                    category: "Masculino",
                    description: "",
                    priceInCents: favorite.priceInCents,
                    rating: 0,
                    reviews: 0,
                    colors: [favorite.color],
                    sizes: [favorite.size],
                    image: favorite.image,
                    stock: favorite.stock
                  };
                  add(product, favorite.color, favorite.size, {
                    variantId: favorite.variantId,
                    unitPriceInCents: favorite.priceInCents,
                    stock: favorite.stock,
                    image: favorite.image
                  });
                }}
              >
                Adicionar ao carrinho
              </button>
              <button
                className="customer-link-button"
                type="button"
                disabled={pending}
                onClick={() => {
                  localFavorites.remove(favorite.productId);
                  void runAction({ action: "favorite_remove", productId: favorite.productId }, "Produto removido dos favoritos.");
                }}
              >
                Remover
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Reviews({
  pendingReviews,
  reviews,
  runAction,
  pending
}: {
  pendingReviews: PendingReview[];
  reviews: CustomerAccountSnapshot["reviews"];
  runAction: RunAction;
  pending: boolean;
}) {
  const submit = (item: PendingReview) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const files = (event.currentTarget.elements.namedItem("media") as HTMLInputElement)?.files;
    void runAction(
      {
        action: "review_save",
        orderItemId: item.orderItemId,
        rating: Number(form.get("rating")),
        title: form.get("title"),
        content: form.get("content")
      },
      "Avaliação enviada para moderação.",
      files
    );
  };
  return (
    <div className="customer-section-stack">
      <SectionTitle eyebrow="Avaliações" title="Suas avaliações" description="Avalie apenas produtos entregues. O conteúdo passa por moderação." />
      {pendingReviews.length > 0 && (
        <div className="customer-review-list">
          {pendingReviews.map((item) => (
            <form className="customer-panel customer-review-form" key={item.orderItemId} onSubmit={submit(item)}>
              <div>
                <p className="eyebrow">Compra verificada</p>
                <h3>{item.productName}</h3>
                <small>Entregue em {formatDate(item.deliveredAt)}</small>
              </div>
              <label className="customer-field">
                <span>Nota *</span>
                <select name="rating" required defaultValue="">
                  <option value="" disabled>Escolha de 1 a 5 estrelas</option>
                  {[5, 4, 3, 2, 1].map((value) => <option value={value} key={value}>{value} estrela{value > 1 ? "s" : ""}</option>)}
                </select>
              </label>
              <label className="customer-field">
                <span>Título (opcional)</span>
                <input name="title" maxLength={100} />
              </label>
              <label className="customer-field customer-field-full">
                <span>Comentário (opcional)</span>
                <textarea name="content" maxLength={2000} rows={4} />
              </label>
              <label className="customer-field customer-field-full">
                <span>Fotos ou vídeo (opcional)</span>
                <input name="media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4" multiple />
                <small>Até 4 arquivos JPG, PNG, WebP ou MP4, com no máximo 15 MB cada.</small>
              </label>
              <button className="primary-button" type="submit" disabled={pending}>Enviar avaliação</button>
            </form>
          ))}
        </div>
      )}
      <article className="customer-panel">
        <div className="customer-panel-heading"><h3>Histórico</h3><span>{reviews.length} avaliação(ões)</span></div>
        {reviews.length ? (
          <div className="customer-review-history">
            {reviews.map((review) => (
              <div key={review.id}>
                <div><strong>{review.productName}</strong><span className="customer-rating">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span></div>
                <span className={`customer-status status-${review.status}`}>{customerStatusLabel(review.status)}</span>
                {review.title && <h4>{review.title}</h4>}
                {review.content && <p>{review.content}</p>}
                <small>{formatDate(review.createdAt)}</small>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={<Star />} title="Nenhuma avaliação enviada" text={pendingReviews.length ? "Use o formulário acima para avaliar sua compra." : "Compras entregues e aptas aparecerão aqui."} />
        )}
      </article>
    </div>
  );
}

function Coupons({ coupons }: { coupons: CustomerAccountSnapshot["coupons"] }) {
  return (
    <div className="customer-section-stack">
      <SectionTitle eyebrow="Benefícios" title="Cupons e benefícios" description="Consulte descontos efetivamente utilizados em seus pedidos." />
      {coupons.length ? (
        <div className="customer-coupon-list">
          {coupons.map((coupon) => (
            <article className="customer-panel customer-coupon" key={coupon.id}>
              <Tag aria-hidden="true" />
              <div><strong>{coupon.code}</strong><span>{coupon.name}</span><small>Usado em #{coupon.orderCode} · {formatDate(coupon.redeemedAt)}</small></div>
              <strong>- {formatBRL(coupon.discountInCents)}</strong>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Tag />} title="Nenhum benefício utilizado" text="Cupons aplicados em pedidos aparecerão neste histórico." action={<Link className="primary-button" href="/ofertas">Ver ofertas</Link>} />
      )}
    </div>
  );
}

function Addresses({
  addresses,
  profileName,
  runAction,
  pending
}: {
  addresses: CustomerAddress[];
  profileName: string;
  runAction: RunAction;
  pending: boolean;
}) {
  const [editing, setEditing] = useState<CustomerAddress | null | "new">(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void runAction(
      {
        action: "address_save",
        id: editing && editing !== "new" ? editing.id : null,
        label: form.get("label"),
        recipientName: form.get("recipientName"),
        postalCode: form.get("postalCode"),
        street: form.get("street"),
        number: form.get("number"),
        complement: form.get("complement"),
        district: form.get("district"),
        city: form.get("city"),
        state: form.get("state"),
        isDefault: form.get("isDefault") === "on"
      },
      "Endereço salvo com segurança."
    ).then(() => setEditing(null));
  };
  const current = editing && editing !== "new" ? editing : null;
  return (
    <div className="customer-section-stack">
      <SectionTitle eyebrow="Endereços" title="Endereços de entrega" description="Cadastre e escolha seu endereço principal." action={<button className="primary-button compact-button" type="button" onClick={() => setEditing("new")}>Adicionar endereço</button>} />
      {editing && (
        <form className="customer-panel customer-form" onSubmit={submit}>
          <h3>{current ? "Editar endereço" : "Novo endereço"}</h3>
          <div className="customer-form-grid">
            <label className="customer-field"><span>Identificação</span><input name="label" defaultValue={current?.label ?? "Casa"} minLength={2} maxLength={40} required /></label>
            <label className="customer-field"><span>Destinatário</span><input name="recipientName" defaultValue={current?.recipientName ?? profileName} minLength={3} required /></label>
            <label className="customer-field"><span>CEP</span><input name="postalCode" defaultValue={current?.postalCode} pattern="\d{5}-?\d{3}" inputMode="numeric" placeholder="00000-000" required /></label>
            <label className="customer-field"><span>Rua / avenida</span><input name="street" defaultValue={current?.street} required /></label>
            <label className="customer-field"><span>Número</span><input name="number" defaultValue={current?.number} required /></label>
            <label className="customer-field"><span>Complemento</span><input name="complement" defaultValue={current?.complement} /></label>
            <label className="customer-field"><span>Bairro</span><input name="district" defaultValue={current?.district} required /></label>
            <label className="customer-field"><span>Cidade</span><input name="city" defaultValue={current?.city} required /></label>
            <label className="customer-field"><span>UF</span><input name="state" defaultValue={current?.state} maxLength={2} pattern="[A-Za-z]{2}" required /></label>
            <label className="customer-check"><input type="checkbox" name="isDefault" defaultChecked={current?.isDefault ?? addresses.length === 0} />Definir como endereço principal</label>
          </div>
          <div className="customer-form-actions">
            <button className="primary-button" type="submit" disabled={pending}>Salvar endereço</button>
            <button className="secondary-button" type="button" onClick={() => setEditing(null)}>Cancelar</button>
          </div>
        </form>
      )}
      {addresses.length ? (
        <div className="customer-address-grid">
          {addresses.map((address) => (
            <article className="customer-panel customer-address-card" key={address.id}>
              <div className="customer-panel-heading"><h3>{address.label}</h3>{address.isDefault && <span className="customer-status">Principal</span>}</div>
              <p><strong>{address.recipientName}</strong><br />{address.street}, {address.number}{address.complement ? ` · ${address.complement}` : ""}<br />{address.district} · {address.city}/{address.state}<br />CEP {address.postalCode}</p>
              <div className="customer-form-actions">
                <button className="customer-link-button" type="button" onClick={() => setEditing(address)}>Editar</button>
                {!address.isDefault && <button className="customer-link-button" type="button" disabled={pending} onClick={() => void runAction({ action: "address_save", ...address, isDefault: true }, "Endereço definido como principal.")}>Definir principal</button>}
                <button className="customer-link-button danger" type="button" disabled={pending || address.isDefault} title={address.isDefault ? "Defina outro endereço principal antes de excluir." : undefined} onClick={() => void runAction({ action: "address_delete", id: address.id }, "Endereço excluído.")}>Excluir</button>
              </div>
            </article>
          ))}
        </div>
      ) : !editing ? (
        <EmptyState icon={<MapPin />} title="Nenhum endereço cadastrado" text="Adicione um endereço para agilizar o checkout." />
      ) : null}
    </div>
  );
}

function Security({ snapshot }: { snapshot: CustomerAccountSnapshot }) {
  return (
    <div className="customer-section-stack">
      <SectionTitle eyebrow="Segurança" title="Segurança da conta" description="Proteja seu acesso e acompanhe as informações disponíveis da sessão." />
      <div className="customer-security-grid">
        <article className="customer-panel">
          <LockKeyhole aria-hidden="true" />
          <h3>Senha</h3>
          <p>Use uma senha exclusiva e atualize-a sempre que suspeitar de um acesso indevido.</p>
          <Link className="secondary-button" href="/esqueci-senha">Alterar senha</Link>
        </article>
        <article className="customer-panel">
          <ShieldCheck aria-hidden="true" />
          <h3>Sessão atual</h3>
          <p>Último acesso: <strong>{formatDate(snapshot.profile.lastSignInAt)}</strong></p>
          <small>A listagem completa de dispositivos aparecerá quando o provedor disponibilizar sessões por usuário.</small>
        </article>
        <article className="customer-panel">
          <UserRoundCheck aria-hidden="true" />
          <h3>Autenticação adicional</h3>
          <p>O MFA para clientes está planejado e será oferecido quando estiver disponível.</p>
          <span className="customer-status">Futuro</span>
        </article>
      </div>
      <article className="customer-panel customer-data-protection">
        <div><h3>Proteção dos seus dados</h3><p>Dados sensíveis são mascarados e operações usam sua sessão autenticada.</p></div>
        <LogoutButton className="secondary-button" />
      </article>
    </div>
  );
}

function Returns({
  returns,
  orders,
  runAction,
  pending
}: {
  returns: CustomerAccountSnapshot["returns"];
  orders: CustomerOrder[];
  runAction: RunAction;
  pending: boolean;
}) {
  const deliveredItems = orders.filter((order) => order.status === "delivered").flatMap((order) => order.items.map((item) => ({ ...item, orderCode: order.publicCode })));
  const [open, setOpen] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void runAction({ action: "return_request", orderItemId: form.get("orderItemId"), quantity: Number(form.get("quantity")), reason: form.get("reason"), description: form.get("description"), resolution: form.get("resolution") }, "Solicitação enviada para análise.").then(() => setOpen(false));
  };
  return (
    <div className="customer-section-stack">
      <SectionTitle eyebrow="Pós-venda" title="Trocas e devoluções" description="Solicite a análise de itens entregues e acompanhe cada etapa." action={deliveredItems.length ? <button className="primary-button compact-button" type="button" onClick={() => setOpen(true)}>Nova solicitação</button> : undefined} />
      {open && (
        <form className="customer-panel customer-form" onSubmit={submit}>
          <h3>Solicitar troca ou devolução</h3>
          <div className="customer-form-grid">
            <label className="customer-field customer-field-full"><span>Produto entregue</span><select name="orderItemId" required>{deliveredItems.map((item) => <option value={item.id} key={item.id}>#{item.orderCode} · {item.productName} · {item.color}/{item.size}</option>)}</select></label>
            <label className="customer-field"><span>Quantidade</span><input name="quantity" type="number" min={1} max={20} defaultValue={1} required /></label>
            <label className="customer-field"><span>Solução desejada</span><select name="resolution"><option value="exchange">Troca</option><option value="refund">Reembolso</option><option value="store_credit">Crédito na loja</option></select></label>
            <label className="customer-field customer-field-full"><span>Motivo</span><input name="reason" minLength={3} maxLength={120} required /></label>
            <label className="customer-field customer-field-full"><span>Descreva o ocorrido</span><textarea name="description" minLength={10} maxLength={2000} rows={4} required /></label>
          </div>
          <div className="customer-form-actions"><button className="primary-button" type="submit" disabled={pending}>Enviar solicitação</button><button className="secondary-button" type="button" onClick={() => setOpen(false)}>Cancelar</button></div>
        </form>
      )}
      {returns.length ? (
        <div className="customer-return-list">
          {returns.map((item) => (
            <article className="customer-panel customer-return-card" key={item.id}>
              <div><small>Solicitação</small><strong>#{item.publicCode}</strong><span>Pedido #{item.orderCode}</span></div>
              <div><span className={`customer-status status-${item.status}`}>{customerStatusLabel(item.status)}</span><small>{formatDate(item.requestedAt)}</small></div>
              <p><strong>{item.reason}</strong><br />{item.description}</p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState icon={<RotateCcw />} title="Nenhuma solicitação em andamento" text={deliveredItems.length ? "Use “Nova solicitação” se precisar de ajuda com um item entregue." : "Itens elegíveis aparecerão após a entrega."} />
      )}
    </div>
  );
}

function Representative({ representative }: { representative: CustomerAccountSnapshot["representative"] }) {
  const hasApplication = Boolean(representative.applicationStatus);
  return (
    <div className="customer-section-stack">
      <SectionTitle eyebrow="Oportunidade curti Z" title="Representante curti Z" description="Envie sua solicitação, documentos e acompanhe a análise sem sair da sua conta." />
      <article className="customer-panel customer-representative-card">
        <UserRoundCheck aria-hidden="true" />
        <div>
          <h3>{representative.approved ? "Você já é representante curti Z" : hasApplication ? `Solicitação #${representative.applicationCode}` : "Quero ser representante"}</h3>
          <p>{representative.approved ? "Acesse seu ambiente profissional separado para consultar materiais, vendas e rede." : hasApplication ? `Status atual: ${customerStatusLabel(representative.applicationStatus)}. Abra a solicitação para acompanhar ou corrigir pendências.` : "Conheça os requisitos e preencha sua solicitação por etapas. O rascunho fica salvo."}</p>
        </div>
        <Link className="primary-button" href={representative.approved ? "/representante" : "/representante/solicitacao"}>
          {representative.approved ? "Abrir Portal do Representante" : hasApplication ? "Acompanhar solicitação" : "Iniciar solicitação"}
        </Link>
      </article>
    </div>
  );
}

function Notifications({
  notifications,
  runAction,
  pending
}: {
  notifications: CustomerAccountSnapshot["notifications"];
  runAction: RunAction;
  pending: boolean;
}) {
  const unread = notifications.filter((item) => !item.readAt).length;
  return (
    <div className="customer-section-stack">
      <SectionTitle eyebrow="Atualizações" title="Notificações" description="Mensagens de pedidos, segurança, atendimento e sua conta." action={unread ? <button className="secondary-button compact-button" type="button" disabled={pending} onClick={() => void runAction({ action: "notification_read" }, "Notificações marcadas como lidas.")}>Marcar todas como lidas</button> : undefined} />
      {notifications.length ? (
        <div className="customer-notification-list">
          {notifications.map((notification) => (
            <article className={`customer-panel customer-notification ${notification.readAt ? "" : "is-unread"}`} key={notification.id}>
              <span><Bell aria-hidden="true" /></span>
              <div><h3>{notification.title}</h3><p>{notification.body}</p><small>{formatDate(notification.createdAt)}</small></div>
              {!notification.readAt && <button className="customer-link-button" type="button" disabled={pending} onClick={() => void runAction({ action: "notification_read", id: notification.id }, "Notificação marcada como lida.")}>Marcar como lida</button>}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Bell />} title="Nenhuma notificação" text="Atualizações importantes da sua conta aparecerão aqui." />
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  text,
  action
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="customer-empty-state">
      <span aria-hidden="true">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
