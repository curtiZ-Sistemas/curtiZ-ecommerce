"use client";

import { calculateSubtotal, formatBRL } from "@curtiz/domain";
import { Check, LoaderCircle, LockKeyhole, MapPin, ShoppingBag, Truck, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useCart } from "@/components/cart-provider";
import {
  CPF_FORMATTED_MAX_LENGTH,
  CUSTOMER_EMAIL_MAX_LENGTH,
  formatBrazilianPhone,
  formatCpf,
  isValidBrazilianPhone,
  isValidCpf,
  isValidCustomerEmail,
  phoneDigits,
  PHONE_FORMATTED_MAX_LENGTH,
  sanitizeCpf
} from "@/lib/personal-data";

const states = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

const checkoutSteps = ["Conta", "Dados", "Endereço", "Entrega", "Pagamento", "Revisão", "Confirmação"] as const;
const currentCheckoutStep = 2;

type PersonalField = "email" | "phone" | "cpf";

function CheckoutProgress() {
  const currentLabel = checkoutSteps[currentCheckoutStep - 1];
  return (
    <nav className="checkout-progress" aria-label="Progresso do checkout">
      <ol className="checkout-steps">
        {checkoutSteps.map((label, index) => {
          const number = index + 1;
          const completed = number < currentCheckoutStep;
          const current = number === currentCheckoutStep;
          return (
            <li
              className={completed ? "completed" : current ? "active" : undefined}
              aria-current={current ? "step" : undefined}
              key={label}
            >
              <span>
                {completed ? <Check aria-hidden="true" /> : number}
                {completed && <i className="sr-only">Etapa concluída:</i>}
              </span>
              <strong>{label}</strong>
            </li>
          );
        })}
      </ol>
      <div className="checkout-progress-mobile">
        <div>
          <span>Etapa {currentCheckoutStep} de {checkoutSteps.length}</span>
          <strong>{currentLabel}</strong>
        </div>
        <progress
          aria-label={`Etapa ${currentCheckoutStep} de ${checkoutSteps.length}: ${currentLabel}`}
          max={checkoutSteps.length}
          value={currentCheckoutStep}
        />
        <p>
          <span>Anterior: {checkoutSteps[currentCheckoutStep - 2]}</span>
          <span>Próxima: {checkoutSteps[currentCheckoutStep]}</span>
        </p>
      </div>
    </nav>
  );
}

type SavedAddress = {
  id: string;
  label: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  isDefault: boolean;
};

export default function CheckoutPage() {
  const { hydrated, lines, clear } = useCart();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [paymentUnavailable, setPaymentUnavailable] = useState(false);
  const [supportCode, setSupportCode] = useState("");
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const closeDialogRef = useRef<HTMLButtonElement>(null);
  const paymentDialogRef = useRef<HTMLElement>(null);
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PersonalField, string>>>({});
  const subtotal = calculateSubtotal(lines);

  const setFieldIfEmpty = useCallback((name: string, value: string) => {
    const field = formRef.current?.elements.namedItem(name);
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
      if (!field.value) field.value = value;
    }
  }, []);

  const applyAddress = useCallback((address: SavedAddress) => {
    const values: Record<string, string> = {
      postalCode: address.postalCode,
      street: address.street,
      number: address.number,
      complement: address.complement,
      district: address.district,
      city: address.city,
      state: address.state
    };
    for (const [name, value] of Object.entries(values)) {
      const field = formRef.current?.elements.namedItem(name);
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = value;
    }
  }, []);

  useEffect(() => {
    if (!hydrated || !lines.length) return;
    const controller = new AbortController();
    void fetch("/api/checkout/profile", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          profile?: { fullName?: string; email?: string; phone?: string } | null;
          addresses?: SavedAddress[];
        };
      })
      .then((payload) => {
        if (!payload) return;
        setFieldIfEmpty("name", payload.profile?.fullName ?? "");
        setFieldIfEmpty("email", payload.profile?.email ?? "");
        setFieldIfEmpty("phone", formatBrazilianPhone(payload.profile?.phone ?? ""));
        const addresses = Array.isArray(payload.addresses) ? payload.addresses : [];
        setSavedAddresses(addresses);
        const preferred = addresses.find((address) => address.isDefault) ?? addresses[0];
        if (preferred) applyAddress(preferred);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [applyAddress, hydrated, lines.length, setFieldIfEmpty]);

  useEffect(() => {
    if (!paymentUnavailable) return;
    closeDialogRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPaymentUnavailable(false);
        submitButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = paymentDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
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
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [paymentUnavailable]);

  const closePaymentDialog = () => {
    setPaymentUnavailable(false);
    window.setTimeout(() => submitButtonRef.current?.focus(), 0);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    if (!lines.length) {
      setMessage("Adicione um produto antes de finalizar.");
      return;
    }

    setMessage("");
    const form = new FormData(event.currentTarget);
    const formString = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    const email = formString("email");
    const phone = formString("phone");
    const cpf = formString("cpf");
    const errors: Partial<Record<PersonalField, string>> = {};
    if (!isValidCustomerEmail(email)) errors.email = "Informe um e-mail válido.";
    if (!isValidBrazilianPhone(phone)) errors.phone = "Informe um telefone válido com DDD.";
    if (!isValidCpf(cpf)) errors.cpf = "Informe um CPF válido.";
    setFieldErrors(errors);
    const firstInvalid = (Object.keys(errors) as PersonalField[])[0];
    if (firstInvalid) {
      setMessage("Revise os dados de identificação informados.");
      const invalidField = formRef.current?.elements.namedItem(firstInvalid);
      if (invalidField instanceof HTMLElement) invalidField.focus();
      return;
    }
    if (!event.currentTarget.checkValidity()) {
      event.currentTarget.reportValidity();
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempotencyKeyRef.current,
          customer: {
            name: form.get("name"),
            email,
            phone: phoneDigits(phone),
            cpf: sanitizeCpf(cpf)
          },
          address: {
            postalCode: form.get("postalCode"),
            street: form.get("street"),
            number: form.get("number"),
            complement: form.get("complement"),
            district: form.get("district"),
            city: form.get("city"),
            state: form.get("state")
          },
          lines: lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            color: line.color,
            size: line.size,
            quantity: line.quantity
          }))
        })
      });
      const result = (await response.json()) as {
        ok: boolean;
        orderCode?: string;
        code?: string;
        message?: string;
        redirectTo?: string;
      };
      if (response.status === 401 && result.redirectTo) {
        router.replace(result.redirectTo);
        return;
      }
      if (result.code === "PAYMENT_UNAVAILABLE") {
        const requestId = response.headers.get("x-request-id") ?? "";
        setSupportCode(requestId ? requestId.slice(0, 8).toUpperCase() : "");
        setPaymentUnavailable(true);
        return;
      }
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
          <h1>Finalizar compra</h1>
          <p>Revise seus dados. Preço, estoque e entrega serão confirmados no servidor.</p>
        </div>
      </div>

      <CheckoutProgress />

      <form ref={formRef} className="checkout-layout" noValidate onSubmit={(event) => void submit(event)}>
        <div className="checkout-form-column">
          <section className="form-card checkout-section">
            <header><span><UserRound /></span><div><h2>Identificação</h2><p>Dados de quem receberá as atualizações do pedido.</p></div></header>
            <div className="form-grid">
              <div className="field field-wide">
                <label htmlFor="name">Nome completo</label>
                <input id="name" name="name" autoComplete="name" required minLength={3} maxLength={120} placeholder="Nome e sobrenome" />
              </div>
              <div className="field">
                <label htmlFor="email">E-mail</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={CUSTOMER_EMAIL_MAX_LENGTH}
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={fieldErrors.email ? "checkout-email-error" : undefined}
                  onInput={() => setFieldErrors((current) => ({ ...current, email: undefined }))}
                  required
                  placeholder="voce@exemplo.com.br"
                />
                {fieldErrors.email && <p className="field-error" id="checkout-email-error" role="alert">{fieldErrors.email}</p>}
              </div>
              <div className="field">
                <label htmlFor="phone">Telefone</label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={PHONE_FORMATTED_MAX_LENGTH}
                  aria-invalid={Boolean(fieldErrors.phone)}
                  aria-describedby={fieldErrors.phone ? "checkout-phone-error" : undefined}
                  onInput={(event) => {
                    event.currentTarget.value = formatBrazilianPhone(event.currentTarget.value);
                    setFieldErrors((current) => ({ ...current, phone: undefined }));
                  }}
                  required
                  placeholder="(11) 99999-9999"
                />
                {fieldErrors.phone && <p className="field-error" id="checkout-phone-error" role="alert">{fieldErrors.phone}</p>}
              </div>
              <div className="field">
                <label htmlFor="cpf">CPF para o pedido</label>
                <input
                  id="cpf"
                  name="cpf"
                  inputMode="numeric"
                  maxLength={CPF_FORMATTED_MAX_LENGTH}
                  aria-invalid={Boolean(fieldErrors.cpf)}
                  aria-describedby={fieldErrors.cpf ? "checkout-cpf-error" : undefined}
                  onInput={(event) => {
                    event.currentTarget.value = formatCpf(event.currentTarget.value);
                    setFieldErrors((current) => ({ ...current, cpf: undefined }));
                  }}
                  required
                  placeholder="000.000.000-00"
                />
                {fieldErrors.cpf && <p className="field-error" id="checkout-cpf-error" role="alert">{fieldErrors.cpf}</p>}
              </div>
            </div>
          </section>

          <section className="form-card checkout-section">
            <header><span><MapPin /></span><div><h2>Endereço de entrega</h2><p>Não oferecemos retirada em loja.</p></div></header>
            {savedAddresses.length ? (
              <div className="checkout-saved-addresses">
                <label htmlFor="savedAddress">Usar endereço salvo</label>
                <select
                  id="savedAddress"
                  defaultValue={(savedAddresses.find((address) => address.isDefault) ?? savedAddresses[0])?.id}
                  onChange={(event) => {
                    const selected = savedAddresses.find((address) => address.id === event.target.value);
                    if (selected) applyAddress(selected);
                  }}
                >
                  {savedAddresses.map((address) => <option value={address.id} key={address.id}>{address.label}</option>)}
                </select>
                <Link href="/minha-conta/enderecos?returnTo=/checkout">Gerenciar endereços</Link>
              </div>
            ) : null}
            <div className="form-grid address-grid">
              <div className="field">
                <label htmlFor="postalCode">CEP</label>
                <input id="postalCode" name="postalCode" inputMode="numeric" autoComplete="postal-code" maxLength={9} required placeholder="00000-000" />
              </div>
              <div className="field field-street">
                <label htmlFor="street">Endereço</label>
                <input id="street" name="street" autoComplete="address-line1" maxLength={160} required />
              </div>
              <div className="field">
                <label htmlFor="number">Número</label>
                <input id="number" name="number" maxLength={20} required />
              </div>
              <div className="field">
                <label htmlFor="complement">Complemento <span className="optional-label">(opcional)</span></label>
                <input id="complement" name="complement" autoComplete="address-line2" maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor="district">Bairro</label>
                <input id="district" name="district" maxLength={100} required />
              </div>
              <div className="field">
                <label htmlFor="city">Cidade</label>
                <input id="city" name="city" autoComplete="address-level2" maxLength={100} required />
              </div>
              <div className="field">
                <label htmlFor="state">Estado</label>
                <select id="state" name="state" autoComplete="address-level1" required defaultValue="">
                  <option value="" disabled>Selecione</option>
                  {states.map((state) => (
                    <option key={state}>{state}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="form-card checkout-section">
            <header><span><Truck /></span><div><h2>Entrega</h2><p>A disponibilidade e o valor serão confirmados para o endereço informado.</p></div></header>
            <div className="shipping-option checkout-pending-option" role="status">
              <span><strong>Entrega para o endereço selecionado</strong><small>O cálculo será validado antes de qualquer cobrança.</small></span>
              <strong>A calcular</strong>
            </div>
          </section>

          <section className="form-card checkout-section">
            <header><span><LockKeyhole /></span><div><h2>Pagamento</h2><p>Confira o resumo antes de avançar para o pagamento online.</p></div></header>
            <div className="checkout-payment-summary">
              <Check aria-hidden="true" />
              <p>Preço, variante, estoque, descontos e entrega serão validados novamente pelo servidor.</p>
            </div>
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
          <div className="summary-line"><span>Entrega</span><strong>A calcular</strong></div>
          <div className="summary-line summary-total"><span>Subtotal atual</span><strong>{formatBRL(subtotal)}</strong></div>
          <button
            ref={submitButtonRef}
            className="primary-button full-button checkout-button"
            type="submit"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? <LoaderCircle className="spin" /> : <LockKeyhole />}
            {loading ? "Validando pedido…" : "Confirmar e pagar"}
          </button>
          <p className="secure-note"><Check /> Nenhuma cobrança ocorre antes da confirmação do provedor.</p>
        </aside>
      </form>
      {paymentUnavailable && (
        <div className="checkout-dialog-backdrop" onMouseDown={closePaymentDialog}>
          <section
            ref={paymentDialogRef}
            className="checkout-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="payment-unavailable-title"
            aria-describedby="payment-unavailable-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="empty-state-icon"><LockKeyhole /></span>
            <h2 id="payment-unavailable-title">Pagamento online indisponível no momento</h2>
            <p id="payment-unavailable-description">
              Não foi possível concluir o pagamento. Nenhuma cobrança foi realizada.
            </p>
            {supportCode && <small>Código para suporte: {supportCode}</small>}
            <div className="checkout-dialog-actions">
              <button ref={closeDialogRef} className="primary-button" type="button" onClick={closePaymentDialog}>
                Voltar ao checkout
              </button>
              <Link className="secondary-button" href="/produtos">Continuar comprando</Link>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
