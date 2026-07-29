"use client";

import { calculateSubtotal, formatBRL } from "@curtiz/domain";
import { LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useCart } from "@/components/cart-provider";

export default function CheckoutPage() {
  const { lines, clear } = useCart();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const subtotal = calculateSubtotal(lines);
  const shipping = subtotal >= 14_900 ? 0 : 1_990;
  const total = subtotal + shipping;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!lines.length) {
      setMessage("Adicione um produto antes de finalizar.");
      return;
    }
    setLoading(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
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
    setLoading(false);
    if (!result.ok || !result.orderCode) {
      setMessage(result.message ?? "Não foi possível iniciar o pagamento.");
      return;
    }
    clear();
    router.push(`/pedido/pendente?pedido=${encodeURIComponent(result.orderCode)}`);
  };

  return (
    <div className="container page-shell">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Ambiente protegido</p>
          <h1>Checkout</h1>
          <p>Seus dados serão usados somente para processar e entregar o pedido.</p>
        </div>
      </div>
      <form
        className="checkout-layout"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className="form-stack">
          <section className="form-card">
            <h2>1. Identificação</h2>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="name">Nome completo</label>
                <input id="name" name="name" autoComplete="name" required minLength={3} />
              </div>
              <div className="field">
                <label htmlFor="email">E-mail</label>
                <input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              <div className="field">
                <label htmlFor="phone">Telefone</label>
                <input id="phone" name="phone" inputMode="tel" autoComplete="tel" required />
              </div>
              <div className="field">
                <label htmlFor="cpf">CPF para o pedido</label>
                <input id="cpf" name="cpf" inputMode="numeric" required />
              </div>
            </div>
          </section>
          <section className="form-card">
            <h2>2. Endereço de entrega</h2>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="postalCode">CEP</label>
                <input id="postalCode" name="postalCode" inputMode="numeric" autoComplete="postal-code" required />
              </div>
              <div className="field">
                <label htmlFor="street">Endereço</label>
                <input id="street" name="street" autoComplete="street-address" required />
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
                <select id="state" name="state" autoComplete="address-level1" required>
                  <option value="">Selecione</option>
                  {["SP", "RJ", "MG", "PR", "SC", "RS", "BA", "PE", "CE", "GO", "DF"].map((state) => (
                    <option key={state}>{state}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>
          <section className="form-card">
            <h2>3. Entrega</h2>
            <label>
              <input type="radio" defaultChecked /> Entrega padrão — 4 a 7 dias úteis
              <strong style={{ float: "right" }}>{shipping ? formatBRL(shipping) : "Grátis"}</strong>
            </label>
          </section>
          {message && (
            <p className="form-message" role="alert">
              {message}
            </p>
          )}
        </div>
        <aside className="summary-card">
          <h2>Resumo do pedido</h2>
          {lines.map((line) => (
            <div className="summary-line" key={line.variantId}>
              <span>
                {line.quantity}× {line.name}
              </span>
              <strong>{formatBRL(line.quantity * line.unitPriceInCents)}</strong>
            </div>
          ))}
          <div className="summary-line">
            <span>Frete</span>
            <strong>{shipping ? formatBRL(shipping) : "Grátis"}</strong>
          </div>
          <div className="summary-line summary-total">
            <span>Total</span>
            <strong>{formatBRL(total)}</strong>
          </div>
          <button className="primary-button full-button" disabled={loading || !lines.length}>
            <LockKeyhole />
            {loading ? "Validando pedido..." : "Ir para pagamento seguro"}
          </button>
          <p style={{ fontSize: ".75rem", color: "var(--neutral-700)", lineHeight: 1.5 }}>
            No modo local, nenhum pagamento real será processado.
          </p>
        </aside>
      </form>
    </div>
  );
}
