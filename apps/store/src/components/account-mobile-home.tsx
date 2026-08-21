import {
  Bell,
  ChevronRight,
  CircleUserRound,
  ClipboardCheck,
  Heart,
  LockKeyhole,
  MapPin,
  PackageCheck,
  RotateCcw,
  Star,
  Tag,
  UserRoundCheck,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import React from "react";
import type { CustomerAccountSnapshot } from "../lib/customer-account-types";
import {
  customerAccountHref,
  customerAccountSectionTitle,
  type CustomerAccountSection
} from "../lib/customer-account-navigation";
import { LogoutButton } from "./logout-button";
import { UserAvatar } from "./user-avatar";

type MobileMenuItem = {
  title: string;
  description: string;
  href: string;
  Icon: LucideIcon;
  opportunity?: boolean;
};

const plural = (value: number, singular: string, pluralValue: string) =>
  `${value} ${value === 1 ? singular : pluralValue}`;

export function AccountMobileHome({
  snapshot,
  favoriteCount
}: {
  snapshot: CustomerAccountSnapshot;
  favoriteCount: number;
}) {
  const ordersInProgress = snapshot.orders.filter((order) =>
    [
      "pending_payment",
      "payment_approved",
      "processing",
      "picking",
      "ready_to_ship",
      "shipped"
    ].includes(order.status)
  ).length;
  const unreadNotifications = snapshot.notifications.filter(
    (notification) => !notification.readAt
  ).length;
  const openReturns = snapshot.returns.filter(
    (item) =>
      !["completed", "refunded", "exchange_sent", "rejected", "cancelled"].includes(
        item.status
      )
  ).length;
  const representativeItem: MobileMenuItem = snapshot.representative.approved
    ? {
        title: "Painel do representante",
        description: "",
        href: "/representante",
        Icon: UserRoundCheck
      }
    : {
        title: "Seja um representante",
        description: "Conheça o programa de representantes",
        href: snapshot.representative.applicationStatus
          ? "/minha-conta/representante"
          : "/representante/solicitacao",
        Icon: UserRoundCheck,
        opportunity: true
      };
  const items: MobileMenuItem[] = [
    {
      title: "Meus pedidos",
      description: ordersInProgress
        ? `${plural(ordersInProgress, "pedido", "pedidos")} em andamento`
        : "Acompanhe suas compras",
      href: "/minha-conta/pedidos",
      Icon: PackageCheck
    },
    {
      title: "Favoritos",
      description: favoriteCount
        ? `${plural(favoriteCount, "produto salvo", "produtos salvos")}`
        : "Produtos que você salvou",
      href: "/minha-conta/favoritos",
      Icon: Heart
    },
    {
      title: "Meu perfil",
      description: "Seus dados pessoais",
      href: "/minha-conta/perfil",
      Icon: CircleUserRound
    },
    {
      title: "Meus endereços",
      description: snapshot.addresses.length
        ? plural(snapshot.addresses.length, "endereço cadastrado", "endereços cadastrados")
        : "Locais de entrega",
      href: "/minha-conta/enderecos",
      Icon: MapPin
    },
    {
      title: "Minhas avaliações",
      description: snapshot.pendingReviews.length
        ? `${plural(snapshot.pendingReviews.length, "avaliação pendente", "avaliações pendentes")}`
        : "Avalie suas compras",
      href: "/minha-conta/avaliacoes",
      Icon: Star
    },
    {
      title: "Segurança",
      description: "Senha e acesso à conta",
      href: "/minha-conta/seguranca",
      Icon: LockKeyhole
    },
    representativeItem,
    {
      title: "Atendimento",
      description: "Ajuda com sua conta e seus pedidos",
      href: "/minha-conta/atendimento",
      Icon: ClipboardCheck
    },
    {
      title: "Cupons e benefícios",
      description: snapshot.coupons.length
        ? plural(snapshot.coupons.length, "cupom utilizado", "cupons utilizados")
        : "Seu histórico de benefícios",
      href: "/minha-conta/cupons",
      Icon: Tag
    },
    {
      title: "Trocas e devoluções",
      description: openReturns
        ? `${plural(openReturns, "solicitação aberta", "solicitações abertas")}`
        : "Acompanhe suas solicitações",
      href: "/minha-conta/trocas",
      Icon: RotateCcw
    },
    {
      title: "Notificações",
      description: unreadNotifications
        ? `${plural(unreadNotifications, "mensagem nova", "mensagens novas")}`
        : "Atualizações da sua conta",
      href: "/minha-conta/notificacoes",
      Icon: Bell
    }
  ];

  const firstName = snapshot.profile.fullName.trim().split(/\s+/)[0] || "cliente";

  return (
    <section className="account-mobile-home" aria-labelledby="account-mobile-title">
      <header className="account-mobile-profile">
        <p className="eyebrow">Área do cliente</p>
        <UserAvatar
          name={snapshot.profile.fullName}
          src={snapshot.profile.avatarUrl}
          size="large"
          className="customer-avatar large"
        />
        <div>
          <h1 id="account-mobile-title">Olá, {firstName}</h1>
          <p>{snapshot.profile.email}</p>
          <small>Minha conta curti Z</small>
        </div>
      </header>

      <nav className="account-mobile-menu" aria-label="Central da conta">
        {items.map(({ title, description, href, Icon, opportunity }) => (
          <Link
            className={opportunity ? "is-opportunity" : undefined}
            href={href}
            key={title}
          >
            <span className="account-mobile-menu-icon" aria-hidden="true">
              <Icon />
            </span>
            <span className="account-mobile-menu-copy">
              <strong>{title}</strong>
              {description && <small>{description}</small>}
            </span>
            <ChevronRight aria-hidden="true" />
          </Link>
        ))}
      </nav>

      <LogoutButton className="account-mobile-logout" />
    </section>
  );
}

export function AccountMobileSubpageHeader({
  section
}: {
  section: CustomerAccountSection;
}) {
  return (
    <header className="account-mobile-subpage-header">
      <Link href={customerAccountHref("visao-geral")}>
        <span aria-hidden="true">‹</span>
        Voltar
      </Link>
      <h1>{customerAccountSectionTitle(section)}</h1>
    </header>
  );
}
