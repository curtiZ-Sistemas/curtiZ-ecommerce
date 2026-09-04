"use client";

import { Heart, Menu, Search, ShoppingBag, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { fetchPublicAuthSession } from "@/lib/auth-session-client";
import { BrandLogo } from "./brand-logo";
import { useCart } from "./cart-provider";
import { SearchAutocomplete } from "./search-autocomplete";

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
  const [accountName, setAccountName] = useState<string>();
  const pathname = usePathname();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const { hydrated, lines } = useCart();
  const items = lines.reduce((total, line) => total + line.quantity, 0);
  useEffect(() => {
    let active = true;
    void fetchPublicAuthSession()
      .then((result) => {
        if (active && result.authenticated && result.fullName) setAccountName(result.fullName);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
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

          <SearchAutocomplete idPrefix="desktop" className="desktop-search" />

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
              prefetch={false}
              aria-label={accountName ? "Acessar minha conta" : "Entrar na minha conta"}
            >
              <UserRound />
              <span className="account-copy">
                <small>{accountName ? `Olá, ${accountName.split(" ")[0]}` : "Olá, entre"}</small>
                Minha conta
              </span>
            </Link>
            <Link className="favorite-action" href="/favoritos" prefetch={false} aria-label="Favoritos">
              <Heart />
            </Link>
            <Link href="/carrinho" prefetch={false} className="cart-link" aria-label={`Carrinho com ${items} itens`}>
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
              <SearchAutocomplete
                idPrefix="mobile"
                autoFocus
                onNavigate={() => setSearchOpen(false)}
              />
            </div>
          </div>
        )}

        <nav className="desktop-nav container" aria-label="Categorias principais">
          <Link
            className={pathname === "/" ? "active" : ""}
            href="/"
            prefetch={false}
            aria-current={pathname === "/" ? "page" : undefined}
          >
            Início
          </Link>
          {navigation.map(([label, href]) => (
            <Link
              className={pathname === href ? "active" : ""}
              href={href}
              prefetch={false}
              aria-current={pathname === href ? "page" : undefined}
              key={href}
            >
              {label}
            </Link>
          ))}
          <Link
            className={pathname === "/rastrear-pedido" ? "active" : ""}
            href="/rastrear-pedido"
            prefetch={false}
            aria-current={pathname === "/rastrear-pedido" ? "page" : undefined}
          >
            Rastrear pedido
          </Link>
          <Link
            className={pathname === "/ajuda" ? "active" : ""}
            href="/ajuda"
            prefetch={false}
            aria-current={pathname === "/ajuda" ? "page" : undefined}
          >
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
              <Link href="/" prefetch={false}>Início</Link>
              {navigation.map(([label, href]) => (
                <Link href={href} prefetch={false} key={href}>
                  {label}
                </Link>
              ))}
              <Link href="/favoritos" prefetch={false}>Favoritos</Link>
              <Link href="/rastrear-pedido" prefetch={false}>Rastrear pedido</Link>
              <Link href="/ajuda" prefetch={false}>Central de ajuda</Link>
            </nav>
            <div className="mobile-drawer-actions">
              <Link
                className="primary-button full-button"
                href={accountName ? "/minha-conta" : "/login"}
                prefetch={false}
              >
                <UserRound /> {accountName ? "Minha conta" : "Acessar minha conta"}
              </Link>
              <Link className="secondary-button full-button" href="/carrinho" prefetch={false}>
                <ShoppingBag /> Ver carrinho {items > 0 ? `(${items})` : ""}
              </Link>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
