"use client";

import {
  Activity,
  BadgeDollarSign,
  Boxes,
  ChartNoAxesCombined,
  CircleGauge,
  ExternalLink,
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
  Webhook,
  X
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  const storeUrl = process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000";

  return (
    <div className="panel-layout">
      {menuOpen && (
        <button className="panel-backdrop" onClick={closeMenu} aria-label="Fechar navegação" />
      )}
      <aside className={menuOpen ? "sidebar open" : "sidebar"}>
        <div className="sidebar-heading">
          <Link className="panel-brand" href={`/${role}`} onClick={closeMenu}>
            CURTI<span>Z</span>
          </Link>
          <button className="sidebar-close" onClick={closeMenu} aria-label="Fechar menu">
            <X />
          </button>
        </div>
        <p className="sidebar-context">Painel {roleLabels[role]}</p>
        <nav className="side-nav" aria-label={`Menu ${roleLabels[role]}`}>
          {menus[role].map(([label, route, Icon]) => {
            const href = route ? `/${role}/${route}` : `/${role}`;
            return (
              <Link
                className={section === route ? "active" : ""}
                href={href}
                key={href}
                onClick={closeMenu}
              >
                <Icon size={19} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <Link className="support-card" href={`/${role}/atendimentos`}>
          <LifeBuoy size={20} />
          <span><strong>Precisa de ajuda?</strong><small>Suporte interno auditado</small></span>
        </Link>
      </aside>

      <div className="panel-main">
        <header className="topbar">
          <button
            className="menu-toggle"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
            aria-expanded={menuOpen}
          >
            <Menu />
          </button>
          <div className={searchOpen ? "topbar-search open" : "topbar-search"}>
            {searchOpen && (
              <form action={`/${role}/pedidos`}>
                <label className="sr-only" htmlFor="panel-search">Buscar no painel</label>
                <input id="panel-search" name="q" placeholder="Pedido, cliente ou produto…" autoFocus />
              </form>
            )}
            <button
              onClick={() => setSearchOpen((current) => !current)}
              aria-label={searchOpen ? "Fechar busca" : "Abrir busca"}
              aria-expanded={searchOpen}
            >
              {searchOpen ? <X /> : <Search />}
            </button>
          </div>
          <a className="store-shortcut" href={storeUrl} target="_blank" rel="noreferrer">
            Ver loja <ExternalLink aria-hidden="true" />
          </a>
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
