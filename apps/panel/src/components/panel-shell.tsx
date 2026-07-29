"use client";

import {
  Activity,
  BadgeDollarSign,
  Boxes,
  ChartNoAxesCombined,
  CircleGauge,
  FileClock,
  Headphones,
  LifeBuoy,
  Menu,
  MessageSquareText,
  PackageCheck,
  PanelsTopLeft,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Tags,
  Users,
  Webhook
} from "lucide-react";
import Link from "next/link";

export type PanelRole = "operacional" | "administracao" | "gerencia" | "tecnico";

const menus: Record<PanelRole, Array<[string, string, React.ComponentType<{ size?: number }> ]>> = {
  operacional: [
    ["Fila operacional", "", CircleGauge],
    ["Pedidos", "pedidos", ShoppingBag],
    ["Separação", "separacao", PackageCheck],
    ["Expedição", "expedicao", Boxes],
    ["Estoque", "estoque", Boxes],
    ["Trocas", "trocas", FileClock],
    ["Atendimento atribuído", "atendimentos", Headphones]
  ],
  administracao: [
    ["Dashboard", "", PanelsTopLeft],
    ["Pedidos", "pedidos", ShoppingBag],
    ["Produtos", "produtos", Boxes],
    ["Banners e CMS", "conteudo", PanelsTopLeft],
    ["Cupons e promoções", "promocoes", Tags],
    ["Estoque", "estoque", PackageCheck],
    ["Atendimentos", "atendimentos", Headphones],
    ["Clientes", "clientes", Users],
    ["Usuários", "usuarios", ShieldCheck],
    ["Configurações", "configuracoes", Settings]
  ],
  gerencia: [
    ["Visão estratégica", "", ChartNoAxesCombined],
    ["Financeiro", "financeiro", BadgeDollarSign],
    ["Vendas", "vendas", ShoppingBag],
    ["Relatórios", "relatorios", ChartNoAxesCombined],
    ["Aprovações", "aprovacoes", ShieldCheck],
    ["Atendimentos", "atendimentos", Headphones],
    ["Auditoria", "auditoria", FileClock]
  ],
  tecnico: [
    ["Saúde do sistema", "", Activity],
    ["Logs e erros", "logs", FileClock],
    ["Integrações", "integracoes", Webhook],
    ["Webhooks e filas", "webhooks", MessageSquareText],
    ["Sessões", "sessoes", Users],
    ["Backups", "backups", FileClock],
    ["Feature flags", "features", Settings],
    ["Atendimentos técnicos", "atendimentos", Headphones]
  ]
};

const roleLabels: Record<PanelRole, string> = {
  operacional: "Operacional",
  administracao: "Administrador",
  gerencia: "Gerência",
  tecnico: "Técnico"
};

export function PanelShell({
  role,
  section,
  children
}: {
  role: PanelRole;
  section: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel-layout">
      <aside className="sidebar">
        <Link className="panel-brand" href={`/${role}`}>
          CURTI<span>Z</span>
        </Link>
        <nav className="side-nav" aria-label={`Menu ${roleLabels[role]}`}>
          {menus[role].map(([label, route, Icon]) => {
            const href = route ? `/${role}/${route}` : `/${role}`;
            return (
              <Link className={section === route ? "active" : ""} href={href} key={href}>
                <Icon size={19} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="support-card">
          <LifeBuoy size={20} />
          <strong>Precisa de ajuda?</strong>
          <br />
          Suporte interno auditado.
        </div>
      </aside>
      <div className="panel-main">
        <header className="topbar">
          <button className="menu-toggle" aria-label="Abrir menu">
            <Menu />
          </button>
          <button aria-label="Buscar">
            <Search />
          </button>
          <div className="user-chip">
            <div className="avatar">{roleLabels[role].slice(0, 1)}</div>
            <div>
              <strong>{roleLabels[role]} Demo</strong>
              <small>{roleLabels[role]}</small>
            </div>
          </div>
        </header>
        <main className="panel-content">{children}</main>
      </div>
    </div>
  );
}
