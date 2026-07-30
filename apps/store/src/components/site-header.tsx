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
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandLogo } from "./brand-logo";
import { useCart } from "./cart-provider";

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
  const pathname = usePathname();
  const { hydrated, lines } = useCart();
  const items = lines.reduce((total, line) => total + line.quantity, 0);

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

  return (
    <>
      <div className="benefit-bar" aria-label="Benefícios da compra">
        <span><Truck aria-hidden="true" /> Frete grátis acima de R$ 149</span>
        <span><CreditCard aria-hidden="true" /> Até 6x sem juros</span>
        <span><BadgePercent aria-hidden="true" /> 5% OFF no Pix</span>
      </div>

      <header className="site-header">
        <div className="header-main container">
          <button
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
              className="header-search-toggle"
              type="button"
              onClick={() => setSearchOpen((current) => !current)}
              aria-label={searchOpen ? "Fechar busca" : "Abrir busca"}
              aria-expanded={searchOpen}
            >
              {searchOpen ? <X /> : <Search />}
            </button>
            <Link className="account-action" href="/login" aria-label="Entrar ou acessar minha conta">
              <UserRound />
              <span className="account-copy"><small>Olá, entre</small>Minha conta</span>
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
          <div className="mobile-search-panel">
            <form className="search-form container" action="/busca" role="search">
              <Search aria-hidden="true" />
              <label className="sr-only" htmlFor="mobile-site-search">
                Buscar produtos
              </label>
              <input
                id="mobile-site-search"
                name="q"
                type="search"
                placeholder="O que você procura?"
                autoFocus
              />
              <button type="submit">Buscar</button>
            </form>
          </div>
        )}

        <nav className="desktop-nav container" aria-label="Categorias principais">
          <Link className={pathname === "/" ? "active" : ""} href="/">Início</Link>
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
          <aside className="mobile-drawer" role="dialog" aria-modal="true" aria-label="Menu principal">
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
                <Link href={href} key={href}>{label}</Link>
              ))}
              <Link href="/rastrear-pedido">Rastrear pedido</Link>
              <Link href="/ajuda">Central de ajuda</Link>
            </nav>
            <div className="mobile-drawer-actions">
              <Link className="primary-button full-button" href="/login">
                <UserRound /> Acessar minha conta
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
