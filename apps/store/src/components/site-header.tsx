"use client";

import {
  BadgePercent,
  CreditCard,
  Heart,
  Menu,
  Search,
  ShoppingBag,
  Truck,
  User,
  X
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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
  const [open, setOpen] = useState(false);
  const { lines } = useCart();
  const items = lines.reduce((total, line) => total + line.quantity, 0);

  return (
    <>
      <div className="benefit-bar" aria-label="Benefícios">
        <span><Truck aria-hidden="true" /> Frete grátis acima de R$ 149</span>
        <span><CreditCard aria-hidden="true" /> Parcele em até 6x sem juros</span>
        <span><BadgePercent aria-hidden="true" /> 5% OFF no Pix</span>
      </div>
      <header className="site-header">
        <div className="header-main container">
          <button className="icon-button menu-button" onClick={() => setOpen(true)} aria-label="Abrir menu">
            <Menu />
          </button>
          <BrandLogo />
          <form className="search-form" action="/busca" role="search">
            <Search size={20} aria-hidden="true" />
            <label className="sr-only" htmlFor="site-search">
              Buscar produtos
            </label>
            <input id="site-search" name="q" placeholder="O que você está procurando?" />
            <button type="submit">Buscar</button>
          </form>
          <nav className="header-actions" aria-label="Ações da conta">
            <Link href="/login" aria-label="Entrar ou acessar minha conta">
              <User />
              <span className="account-copy"><small>Entrar</small>Minha conta</span>
            </Link>
            <Link href="/minha-conta/favoritos" aria-label="Favoritos">
              <Heart />
            </Link>
            <Link href="/carrinho" className="cart-link" aria-label={`Carrinho com ${items} itens`}>
              <ShoppingBag />
              {items > 0 && <span className="cart-count">{items}</span>}
            </Link>
          </nav>
        </div>
        <nav className="desktop-nav container" aria-label="Categorias principais">
          <Link href="/">Início</Link>
          {navigation.map(([label, href]) => (
            <Link href={href} key={href}>
              {label}
            </Link>
          ))}
          <Link href="/rastrear-pedido">Rastrear pedido</Link>
          <Link href="/ajuda">Atendimento</Link>
        </nav>
      </header>
      {open && (
        <div className="mobile-menu-layer">
          <button
            className="mobile-menu-backdrop"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
          />
          <div className="mobile-drawer" role="dialog" aria-modal="true" aria-label="Menu">
            <button className="icon-button close-button" onClick={() => setOpen(false)} aria-label="Fechar menu">
              <X />
            </button>
            <BrandLogo />
            <nav>
              <Link href="/" onClick={() => setOpen(false)}>Início</Link>
              {navigation.map(([label, href]) => (
                <Link href={href} key={href} onClick={() => setOpen(false)}>
                  {label}
                </Link>
              ))}
              <Link href="/ajuda" onClick={() => setOpen(false)}>Central de ajuda</Link>
              <Link className="mobile-account-link" href="/login" onClick={() => setOpen(false)}>
                Acessar minha conta
              </Link>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
