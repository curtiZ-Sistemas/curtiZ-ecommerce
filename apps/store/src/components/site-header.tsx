"use client";

import {
  BadgePercent,
  CreditCard,
  Heart,
  Menu,
  Search,
  ShoppingBag,
  Truck,
  UserRound,
  X
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { BrandLogo } from "./brand-logo";
import { useCart } from "./cart-provider";
import { demoProducts } from "@/lib/catalog";

const navigation = [
  ["Masculino", "/masculino"],
  ["Feminino", "/feminino"],
  ["Infantil", "/infantil"],
  ["Slides", "/slides"],
  ["Sandálias", "/sandalias"],
  ["Lançamentos", "/lancamentos"],
  ["Ofertas", "/ofertas"],
  ["Mais vendidos", "/mais-vendidos"]
] as const;

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [accountName, setAccountName] = useState<string>();
  const pathname = usePathname();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const { hydrated, lines } = useCart();
  const items = lines.reduce((total, line) => total + line.quantity, 0);
  const suggestions = useMemo(() => {
    const normalized = searchQuery.trim().toLocaleLowerCase("pt-BR");
    if (normalized.length < 2) return [];
    return demoProducts
      .filter((product) =>
        `${product.name} ${product.category} ${product.colors.join(" ")}`
          .toLocaleLowerCase("pt-BR")
          .includes(normalized)
      )
      .slice(0, 4);
  }, [searchQuery]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/session", {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { authenticated: boolean; fullName?: string };
      })
      .then((result) => {
        if (result?.authenticated && result.fullName) setAccountName(result.fullName);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen && !searchOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menuOpen) {
        setMenuOpen(false);
        window.setTimeout(() => menuButtonRef.current?.focus(), 0);
      } else {
        setSearchOpen(false);
        window.setTimeout(() => searchButtonRef.current?.focus(), 0);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen, searchOpen]);

  const trapDrawerFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <>

      <header className="site-header">
        <div className="header-main container">
          <button
            ref={menuButtonRef}
            className="icon-button menu-button"
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
            aria-expanded={menuOpen}
          >
            <Menu />
          </button>

          <BrandLogo />

          <form className="search-form desktop-search" action="/busca" role="search">
            <Search aria-hidden="true" />
            <label className="sr-only" htmlFor="site-search">
              Buscar produtos
            </label>
            <input
              id="site-search"
              name="q"
              type="search"
              placeholder="Busque por produto, cor ou categoria"
              autoComplete="off"
            />
            <button type="submit">Buscar</button>
          </form>

          <nav className="header-actions" aria-label="Conta e compras">
            <button
              ref={searchButtonRef}
              className="header-search-toggle"
              type="button"
              onClick={() => setSearchOpen((current) => !current)}
              aria-label={searchOpen ? "Fechar busca" : "Abrir busca"}
              aria-expanded={searchOpen}
            >
              {searchOpen ? <X /> : <Search />}
            </button>
            <Link
              className="account-action"
              href={accountName ? "/minha-conta" : "/login"}
              aria-label={accountName ? "Acessar minha conta" : "Entrar na minha conta"}
            >
              <UserRound />
              <span className="account-copy">
                <small>{accountName ? `Olá, ${accountName.split(" ")[0]}` : "Olá, entre"}</small>
                Minha conta
              </span>
            </Link>
            <Link className="favorite-action" href="/minha-conta/favoritos" aria-label="Favoritos">
              <Heart />
            </Link>
            <Link href="/carrinho" className="cart-link" aria-label={`Carrinho com ${items} itens`}>
              <ShoppingBag />
              {hydrated && items > 0 && <span className="cart-count">{items}</span>}
            </Link>
          </nav>
        </div>

        {searchOpen && (
          <div
            className="mobile-search-panel"
            role="dialog"
            aria-modal="false"
            aria-label="Busca de produtos"
          >
            <div className="container mobile-search-content">
              <form className="search-form" action="/busca" role="search">
                <Search aria-hidden="true" />
                <label className="sr-only" htmlFor="mobile-site-search">
                  Buscar produtos
                </label>
                <input
                  id="mobile-site-search"
                  name="q"
                  type="search"
                  placeholder="O que você procura?"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  autoComplete="off"
                  autoFocus
                />
                <button type="submit">Buscar</button>
              </form>
              {searchQuery.trim().length >= 2 && (
                <div className="search-suggestions" aria-live="polite">
                  <div className="search-suggestions-heading">
                    <strong>
                      {suggestions.length ? "Produtos encontrados" : "Nenhum produto encontrado"}
                    </strong>
                    <span>{suggestions.length} resultados rápidos</span>
                  </div>
                  {suggestions.map((product) => (
                    <Link
                      className="search-suggestion"
                      href={`/produto/${product.slug}`}
                      key={product.id}
                    >
                      <Image src={product.image} alt="" width={56} height={44} />
                      <span>
                        <strong>{product.name}</strong>
                        <small>{product.category}</small>
                      </span>
                    </Link>
                  ))}
                  <Link
                    className="search-all-results"
                    href={`/busca?q=${encodeURIComponent(searchQuery.trim())}`}
                  >
                    Ver resultados completos
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}

        <nav className="desktop-nav container" aria-label="Categorias principais">
          <Link className={pathname === "/" ? "active" : ""} href="/">
            Início
          </Link>
          {navigation.map(([label, href]) => (
            <Link className={pathname === href ? "active" : ""} href={href} key={href}>
              {label}
            </Link>
          ))}
          <Link className={pathname === "/rastrear-pedido" ? "active" : ""} href="/rastrear-pedido">
            Rastrear pedido
          </Link>
          <Link className={pathname === "/ajuda" ? "active" : ""} href="/ajuda">
            Atendimento
          </Link>
        </nav>
      </header>

      {menuOpen && (
        <div className="mobile-menu-layer">
          <button
            className="mobile-menu-backdrop"
            type="button"
            onClick={() => setMenuOpen(false)}
            aria-label="Fechar menu"
          />
          <aside
            className="mobile-drawer"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu principal"
            onKeyDown={trapDrawerFocus}
          >
            <div className="mobile-drawer-header">
              <BrandLogo />
              <button
                className="icon-button close-button"
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Fechar menu"
                autoFocus
              >
                <X />
              </button>
            </div>
            <nav>
              <Link href="/">Início</Link>
              {navigation.map(([label, href]) => (
                <Link href={href} key={href}>
                  {label}
                </Link>
              ))}
              <Link href="/rastrear-pedido">Rastrear pedido</Link>
              <Link href="/ajuda">Central de ajuda</Link>
            </nav>
            <div className="mobile-drawer-actions">
              <Link
                className="primary-button full-button"
                href={accountName ? "/minha-conta" : "/login"}
              >
                <UserRound /> {accountName ? "Minha conta" : "Acessar minha conta"}
              </Link>
              <Link className="secondary-button full-button" href="/carrinho">
                <ShoppingBag /> Ver carrinho {items > 0 ? `(${items})` : ""}
              </Link>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
