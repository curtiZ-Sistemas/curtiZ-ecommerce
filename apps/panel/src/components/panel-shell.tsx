"use client";

import {
  Activity,
  BadgeDollarSign,
  Boxes,
  ChartNoAxesCombined,
  CircleGauge,
  ClipboardCheck,
  ExternalLink,
  FileClock,
  FileText,
  Headphones,
  LifeBuoy,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquareText,
  PackageCheck,
  PackagePlus,
  PanelsTopLeft,
  Search,
  Scale,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Tags,
  Users,
  Wrench,
  Webhook,
  X
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import React, { type KeyboardEvent, useEffect, useRef, useState } from "react";
import logoCurtiz from "../../public/images/logo-curtiz.png";

export type PanelRole = "operacional" | "administracao" | "gerencia" | "tecnico";

const menus: Record<PanelRole, Array<[string, string, React.ComponentType<{ size?: number }>]>> = {
  operacional: [
    ["Dashboard", "", CircleGauge],
    ["Pedidos", "pedidos", ShoppingBag],
    ["Separação", "separacao", ClipboardCheck],
    ["Expedição", "expedicao", PackageCheck],
    ["Envio", "envio", ExternalLink],
    ["Estoque", "estoque", Boxes],
    ["Kits", "kits", PackageCheck],
    ["Montagem de kits", "montagem-kits", PackagePlus],
    ["Reposição", "reposicao", PackagePlus],
    ["Notas fiscais", "notas-fiscais", FileText],
    ["Trocas", "trocas", FileClock],
    ["Devoluções", "devolucoes", FileClock],
    ["Produtos danificados", "danificados", ShieldCheck],
    ["Ocorrências", "ocorrencias", Wrench],
    ["Atendimento atribuído", "atendimentos", Headphones],
    ["Central de Ajuda", "central-ajuda", LifeBuoy],
    ["Mídias da página inicial", "construtor-home", PanelsTopLeft],
    ["Representantes", "representantes", Users],
    ["Pendências", "pendencias", FileClock],
    ["Relatórios operacionais", "relatorios-operacionais", ChartNoAxesCombined],
    ["Políticas oficiais", "politicas", Scale]
  ],
  administracao: [
    ["Dashboard", "", PanelsTopLeft],
    ["Produtos", "produtos", Boxes],
    ["Categorias", "categorias", Tags],
    ["Modelos", "modelos", Boxes],
    ["Coleções", "colecoes", PanelsTopLeft],
    ["Variações", "variacoes", PackagePlus],
    ["Mídias", "midias", PanelsTopLeft],
    ["Estoque", "estoque", PackageCheck],
    ["Pedidos", "pedidos", ShoppingBag],
    ["Clientes", "clientes", Users],
    ["Banners", "banners", PanelsTopLeft],
    ["Construtor da página inicial", "construtor-home", PanelsTopLeft],
    ["Conteúdo", "conteudo", FileText],
    ["Marketing", "marketing", Tags],
    ["Cupons", "cupons", Tags],
    ["Representantes", "representantes", Users],
    ["Kits", "kits", PackageCheck],
    ["Níveis", "niveis", ChartNoAxesCombined],
    ["Metas", "metas", ClipboardCheck],
    ["Comissões autorizadas", "comissoes", BadgeDollarSign],
    ["Criativos", "criativos", PanelsTopLeft],
    ["Campanhas", "campanhas", Tags],
    ["Avaliações", "avaliacoes", MessageSquareText],
    ["Central de Ajuda", "central-ajuda", LifeBuoy],
    ["Políticas e documentos legais", "politicas", Scale],
    ["Treinamentos", "treinamentos", FileText],
    ["Contratos", "contratos", FileClock],
    ["Usuários", "usuarios", ShieldCheck],
    ["Permissões", "permissoes", ShieldCheck],
    ["Configurações administrativas", "configuracoes", Settings]
  ],
  gerencia: [
    ["Dashboard executivo", "", CircleGauge],
    ["Visão estratégica", "visao-estrategica", ChartNoAxesCombined],
    ["Financeiro", "financeiro", BadgeDollarSign],
    ["Pedidos e vendas", "pedidos-vendas", ShoppingBag],
    ["Clientes", "clientes", Users],
    ["Rede de representantes", "representantes", Users],
    ["Solicitações", "solicitacoes-representantes", ClipboardCheck],
    ["Rede de indicações", "rede-indicacoes", Users],
    ["Níveis", "niveis", ChartNoAxesCombined],
    ["Qualificação", "qualificacao", ShieldCheck],
    ["Metas", "metas", ClipboardCheck],
    ["Kits", "kits", PackageCheck],
    ["Comissões", "comissoes", BadgeDollarSign],
    ["Regras de comissão", "regras-comissao", Settings],
    ["Fechamentos", "fechamentos", FileClock],
    ["Pagamentos", "pagamentos", BadgeDollarSign],
    ["Criativos", "criativos", PanelsTopLeft],
    ["Campanhas", "campanhas", Tags],
    ["Construtor da página inicial", "conteudo-loja", PanelsTopLeft],
    ["Banners", "banners", PanelsTopLeft],
    ["Relatórios", "relatorios", ChartNoAxesCombined],
    ["Aprovações", "aprovacoes", ShieldCheck],
    ["Auditoria", "auditoria", FileClock],
    ["Políticas e conformidade", "politicas", Scale],
    ["Simulações", "simulacoes", ChartNoAxesCombined],
    ["Alertas", "alertas", Activity],
    ["Configurações estratégicas", "configuracoes-estrategicas", Settings],
    ["Atendimentos", "atendimentos", Headphones],
    ["Central de Ajuda", "central-ajuda", LifeBuoy]
  ],
  tecnico: [
    ["Visão geral", "", Activity],
    ["Saúde dos serviços", "saude-servicos", CircleGauge],
    ["Logs", "logs", FileClock],
    ["Erros", "erros", ShieldAlert],
    ["Segurança", "seguranca", ShieldCheck],
    ["Acessos técnicos", "acessos-tecnicos", Users],
    ["Integrações", "integracoes", Webhook],
    ["Webhooks", "webhooks", Webhook],
    ["Filas", "filas", MessageSquareText],
    ["Jobs", "jobs", Wrench],
    ["Falhas", "falhas", ShieldAlert],
    ["Banco de dados", "banco-dados", Boxes],
    ["Supabase", "supabase", CircleGauge],
    ["Storage", "storage", Boxes],
    ["Backups", "backups", FileClock],
    ["Auditoria técnica", "auditoria-tecnica", FileClock],
    ["Integridade dos dados", "integridade-dados", ShieldCheck],
    ["Performance", "performance", ChartNoAxesCombined],
    ["Deploys", "deploys", ExternalLink],
    ["Versões", "versoes", FileText],
    ["Sessões", "sessoes", Users],
    ["Feature flags", "feature-flags", Settings],
    ["Configurações técnicas", "configuracoes-tecnicas", Settings],
    ["Atendimentos técnicos", "atendimentos", Headphones]
  ]
};

const roleLabels: Record<PanelRole, string> = {
  operacional: "Operacional",
  administracao: "Administrador",
  gerencia: "Gerência",
  tecnico: "Técnico"
};

const searchRoutes: Record<PanelRole, string> = {
  operacional: "/operacional/pedidos",
  administracao: "/administracao/produtos",
  gerencia: "/gerencia/pedidos-vendas",
  tecnico: "/tecnico/logs"
};

export const panelSearchRoute = (role: PanelRole) => searchRoutes[role];

export function PanelShell({
  role,
  section,
  userName,
  canSwitchPanel = false,
  children
}: {
  role: PanelRole;
  section: string;
  userName?: string;
  canSwitchPanel?: boolean;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const closeMenu = (restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) window.setTimeout(() => menuButtonRef.current?.focus(), 0);
  };
  const configuredStoreUrl = process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000";

  const browserStoreUrl = () => {
    const configured = new URL(configuredStoreUrl);
    const current = new URL(window.location.href);
    const configuredIsLoopback = ["localhost", "127.0.0.1", "::1"].includes(configured.hostname);
    const currentIsLoopback = ["localhost", "127.0.0.1", "::1"].includes(current.hostname);
    if (configuredIsLoopback && !currentIsLoopback) {
      return `${current.protocol}//${current.hostname}:3000`;
    }
    return configured.origin;
  };

  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setLogoutError("");
    try {
      const storeUrl = browserStoreUrl();
      const response = await fetch(`${storeUrl}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) throw new Error("logout_failed");
      window.location.assign(`${storeUrl}/login`);
    } catch {
      setLogoutError("Não foi possível sair. Tente novamente.");
      setSigningOut(false);
    }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeMenu(true);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const trapSidebarFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (!menuOpen || event.key !== "Tab") return;
    const controls = sidebarRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

  return (
    <div className="panel-layout">
      {menuOpen && (
        <button
          className="panel-backdrop"
          type="button"
          onClick={() => closeMenu(true)}
          aria-label="Fechar navegação"
        />
      )}
      <aside
        className={menuOpen ? "sidebar open" : "sidebar"}
        ref={sidebarRef}
        onKeyDown={trapSidebarFocus}
      >
        <div className="sidebar-heading">
          <Link className="panel-brand" href={`/${role}`} onClick={() => closeMenu()}>
            <Image src={logoCurtiz} alt="curti Z" width={150} height={100} priority />
          </Link>
          <button
            className="sidebar-close"
            type="button"
            onClick={() => closeMenu(true)}
            aria-label="Fechar menu"
            autoFocus={menuOpen}
          >
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
                onClick={() => closeMenu()}
              >
                <Icon size={19} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        {canSwitchPanel ? (
          <Link
            className="panel-switch-link sidebar-switch-link"
            href="/selecionar-painel"
            onClick={() => closeMenu()}
          >
            <PanelsTopLeft size={19} />
            <span>Trocar painel</span>
          </Link>
        ) : null}
        <Link className="support-card" href={`/${role}/atendimentos`}>
          <LifeBuoy size={20} />
          <span>
            <strong>Precisa de ajuda?</strong>
            <small>Suporte interno auditado</small>
          </span>
        </Link>
      </aside>

      <div className="panel-main">
        <header className="topbar">
          <button
            ref={menuButtonRef}
            className="menu-toggle"
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
            aria-expanded={menuOpen}
          >
            <Menu />
          </button>
          <div className={searchOpen ? "topbar-search open" : "topbar-search"}>
            {searchOpen && (
              <form action={panelSearchRoute(role)}>
                <label className="sr-only" htmlFor="panel-search">
                  Buscar no painel
                </label>
                <input
                  id="panel-search"
                  name="q"
                  placeholder="Pedido, cliente ou produto…"
                  autoFocus
                />
              </form>
            )}
            <button
              type="button"
              onClick={() => setSearchOpen((current) => !current)}
              aria-label={searchOpen ? "Fechar busca" : "Abrir busca"}
              aria-expanded={searchOpen}
            >
              {searchOpen ? <X /> : <Search />}
            </button>
          </div>
          <a className="store-shortcut" href={configuredStoreUrl} target="_blank" rel="noreferrer">
            Ver loja <ExternalLink aria-hidden="true" />
          </a>
          {canSwitchPanel ? (
            <Link className="panel-switch-link topbar-switch-link" href="/selecionar-painel">
              <PanelsTopLeft aria-hidden="true" /> Trocar painel
            </Link>
          ) : null}
          <div className="user-chip">
            <div className="avatar">{(userName ?? roleLabels[role]).slice(0, 1)}</div>
            <div>
              <strong>{userName ?? roleLabels[role]}</strong>
              <small>{roleLabels[role]}</small>
            </div>
          </div>
          <button
            className="panel-logout"
            type="button"
            onClick={() => {
              void logout();
            }}
            disabled={signingOut}
            aria-label="Sair do painel"
            title="Sair do painel"
          >
            {signingOut ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <LogOut aria-hidden="true" />
            )}
          </button>
          {logoutError && (
            <span className="panel-logout-error" role="alert">
              {logoutError}
            </span>
          )}
        </header>
        <main className="panel-content">{children}</main>
      </div>
    </div>
  );
}
