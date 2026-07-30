"use client";

import { calculateSubtotal, formatBRL } from "@curtiz/domain";
import { Check, LoaderCircle, LockKeyhole, MapPin, ShoppingBag, Truck, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useCart } from "@/components/cart-provider";

export default function CheckoutPage() {
  const { hydrated, lines, clear } = useCart();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const subtotal = calculateSubtotal(lines);
  const shipping = subtotal >= 14_900 ? 0 : 1_990;
  const total = subtotal + shipping;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    if (!lines.length) {
      setMessage("Adicione um produto antes de finalizar.");
      return;
    }

    setLoading(true);
    setMessage("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer: {
            name: form.get("name"),
            email: form.get("email"),
            phone: form.get("phone"),
            cpf: form.get("cpf")
          },
          address: {
            postalCode: form.get("postalCode"),
            street: form.get("street"),
            number: form.get("number"),
            district: form.get("district"),
            city: form.get("city"),
            state: form.get("state")
          },
          lines: lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            quantity: line.quantity
          }))
        })
      });
      const result = (await response.json()) as { ok: boolean; orderCode?: string; message?: string };
      if (!result.ok || !result.orderCode) {
        setMessage(result.message ?? "Não foi possível iniciar o pagamento.");
        return;
      }
      clear();
      router.push(`/pedido/pendente?pedido=${encodeURIComponent(result.orderCode)}`);
    } catch {
      setMessage("Não foi possível conectar ao checkout. Seus itens continuam no carrinho.");
    } finally {
      setLoading(false);
    }
  };

  if (!hydrated) {
    return (
      <div className="container page-shell">
        <div className="checkout-layout">
          <div className="skeleton-card"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-copy" /></div>
          <div className="skeleton-card"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-copy" /></div>
        </div>
      </div>
    );
  }

  if (!lines.length) {
    return (
      <div className="container page-shell">
        <div className="empty-state cart-empty-state">
          <span className="empty-state-icon"><ShoppingBag /></span>
          <h1>Seu carrinho está vazio</h1>
          <p>Adicione um produto antes de iniciar o checkout.</p>
          <Link className="primary-button" href="/produtos">Ver produtos</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container page-shell checkout-page">
      <nav className="breadcrumbs" aria-label="Navegação estrutural">
        <Link href="/carrinho">Carrinho</Link><span>/</span><span>Checkout</span>
      </nav>
      <div className="section-heading checkout-heading">
        <div>
          <p className="eyebrow"><LockKeyhole /> Ambiente protegido</p>
          <h1>Finalizar compra</h1>
          <p>Revise seus dados. Preço, estoque e entrega serão confirmados no servidor.</p>
        </div>
      </div>

      <ol className="checkout-steps" aria-label="Etapas do checkout">
        <li className="active"><span>1</span>Identificação</li>
        <li><span>2</span>Entrega</li>
        <li><span>3</span>Pagamento</li>
      </ol>

      <form className="checkout-layout" onSubmit={(event) => void submit(event)}>
        <div className="checkout-form-column">
          <section className="form-card checkout-section">
            <header><span><UserRound /></span><div><h2>Identificação</h2><p>Dados de quem receberá as atualizações do pedido.</p></div></header>
            <div className="form-grid">
              <div className="field field-wide">
                <label htmlFor="name">Nome completo</label>
                <input id="name" name="name" autoComplete="name" required minLength={3} placeholder="Nome e sobrenome" />
              </div>
              <div className="field">
                <label htmlFor="email">E-mail</label>
                <input id="email" name="email" type="email" autoComplete="email" required placeholder="voce@exemplo.com.br" />
              </div>
              <div className="field">
                <label htmlFor="phone">Telefone</label>
                <input id="phone" name="phone" inputMode="tel" autoComplete="tel" required placeholder="(11) 99999-9999" />
              </div>
              <div className="field">
                <label htmlFor="cpf">CPF para o pedido</label>
                <input id="cpf" name="cpf" inputMode="numeric" required placeholder="000.000.000-00" />
              </div>
            </div>
          </section>

          <section className="form-card checkout-section">
            <header><span><MapPin /></span><div><h2>Endereço de entrega</h2><p>Não oferecemos retirada em loja.</p></div></header>
            <div className="form-grid address-grid">
              <div className="field">
                <label htmlFor="postalCode">CEP</label>
                <input id="postalCode" name="postalCode" inputMode="numeric" autoComplete="postal-code" required placeholder="00000-000" />
              </div>
              <div className="field field-street">
                <label htmlFor="street">Endereço</label>
                <input id="street" name="street" autoComplete="address-line1" required />
              </div>
              <div className="field">
                <label htmlFor="number">Número</label>
                <input id="number" name="number" required />
              </div>
              <div className="field">
                <label htmlFor="district">Bairro</label>
                <input id="district" name="district" required />
              </div>
              <div className="field">
                <label htmlFor="city">Cidade</label>
                <input id="city" name="city" autoComplete="address-level2" required />
              </div>
              <div className="field">
                <label htmlFor="state">Estado</label>
                <select id="state" name="state" autoComplete="address-level1" required defaultValue="">
                  <option value="" disabled>Selecione</option>
                  {["SP", "RJ", "MG", "PR", "SC", "RS", "BA", "PE", "CE", "GO", "DF"].map((state) => (
                    <option key={state}>{state}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="form-card checkout-section">
            <header><span><Truck /></span><div><h2>Método de entrega</h2><p>Prazo estimado após a confirmação do pagamento.</p></div></header>
            <label className="shipping-option">
              <input type="radio" name="shipping" defaultChecked />
              <span><strong>Entrega padrão</strong><small>4 a 7 dias úteis</small></span>
              <strong>{shipping ? formatBRL(shipping) : "Grátis"}</strong>
            </label>
          </section>

          {message && <p className="form-message" role="alert">{message}</p>}
        </div>

        <aside className="summary-card checkout-summary">
          <h2>Resumo do pedido</h2>
          <div className="checkout-products">
            {lines.map((line) => (
              <div className="checkout-product" key={line.variantId}>
                <span className="checkout-product-image">
                  <Image src={line.image} alt="" width={72} height={58} />
                  <i>{line.quantity}</i>
                </span>
                <div><strong>{line.name}</strong><span>{line.color} · {line.size}</span></div>
                <strong>{formatBRL(line.quantity * line.unitPriceInCents)}</strong>
              </div>
            ))}
          </div>
          <div className="summary-line"><span>Subtotal</span><strong>{formatBRL(subtotal)}</strong></div>
          <div className="summary-line"><span>Frete</span><strong>{shipping ? formatBRL(shipping) : "Grátis"}</strong></div>
          <div className="summary-line summary-total"><span>Total</span><strong>{formatBRL(total)}</strong></div>
          <button className="primary-button full-button checkout-button" disabled={loading}>
            {loading ? <LoaderCircle className="spin" /> : <LockKeyhole />}
            {loading ? "Validando pedido…" : "Ir para pagamento seguro"}
          </button>
          <p className="secure-note"><Check /> No modo local, nenhum pagamento real será processado.</p>
        </aside>
      </form>
    </div>
  );
}
