"use client";

import { calculateSubtotal, formatBRL, type CartLine } from "@curtiz/domain";
import { LoaderCircle, LockKeyhole, ShoppingBag } from "lucide-react";
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
import { trackIntelligence } from "../../lib/intelligence-client";

const states = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

const formatPostalCode = (value: string) => {
  const digits = value.replace(/\D/gu, "").slice(0, 8);
  return digits.replace(/^(\d{5})(\d)/u, "$1-$2");
};

type PersonalField = "email" | "phone" | "cpf";

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

function CheckoutProducts({ lines }: { lines: CartLine[] }) {
  return (
    <div className="checkout-products">
      {lines.map((line) => (
        <div className="checkout-product" key={line.variantId}>
          <span className="checkout-product-image">
            <Image src={line.image} alt="" width={72} height={58} />
          </span>
          <div>
            <strong>{line.name}</strong>
            <span>
              {line.color} · {line.size}
            </span>
            <small>Qtd. {line.quantity}</small>
          </div>
          <strong>{formatBRL(line.quantity * line.unitPriceInCents)}</strong>
        </div>
      ))}
    </div>
  );
}

function CheckoutTotals({ subtotal }: { subtotal: number }) {
  return (
    <div className="checkout-totals">
      <div className="summary-line">
        <span>Subtotal</span>
        <strong>{formatBRL(subtotal)}</strong>
      </div>
      <div className="summary-line">
        <span>Entrega</span>
        <strong>A calcular</strong>
      </div>
      <div className="summary-line summary-total">
        <span>Total</span>
        <strong>{formatBRL(subtotal)}</strong>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  const { hydrated, lines, selectedLines, removeMany } = useCart();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [paymentUnavailable, setPaymentUnavailable] = useState(false);
  const [supportCode, setSupportCode] = useState("");
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const closeDialogRef = useRef<HTMLButtonElement>(null);
  const paymentDialogRef = useRef<HTMLElement>(null);
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);
  const trackedCheckoutRef = useRef(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PersonalField, string>>>({});
  const subtotal = calculateSubtotal(selectedLines);

  const focusSubmitAction = useCallback(() => {
    submitButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!hydrated || selectedLines.length === 0 || trackedCheckoutRef.current) return;
    trackedCheckoutRef.current = true;
    trackIntelligence({ type: "checkout_start" });
  }, [hydrated, selectedLines.length]);

  const setFieldIfEmpty = useCallback((name: string, value: string) => {
    const field = formRef.current?.elements.namedItem(name);
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
      if (!field.value) field.value = value;
    }
  }, []);

  const applyAddress = useCallback((address: SavedAddress) => {
    const values: Record<string, string> = {
      postalCode: formatPostalCode(address.postalCode),
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
    if (!hydrated || !selectedLines.length) return;
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
  }, [applyAddress, hydrated, selectedLines.length, setFieldIfEmpty]);

  useEffect(() => {
    if (!paymentUnavailable) return;
    closeDialogRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPaymentUnavailable(false);
        focusSubmitAction();
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
  }, [focusSubmitAction, paymentUnavailable]);

  const closePaymentDialog = () => {
    setPaymentUnavailable(false);
    window.setTimeout(focusSubmitAction, 0);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    if (!selectedLines.length) {
      setMessage("Selecione pelo menos um produto no carrinho antes de finalizar.");
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
          lines: selectedLines.map((line) => ({
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
      const purchasedVariantIds = selectedLines.map((line) => line.variantId);
      setRedirecting(true);
      router.push(`/pedido/pendente?pedido=${encodeURIComponent(result.orderCode)}`);
      removeMany(purchasedVariantIds);
    } catch {
      setMessage("Não foi possível conectar ao checkout. Seus itens continuam no carrinho.");
    } finally {
      setLoading(false);
    }
  };

  if (!hydrated) {
    return (
      <div className="container page-shell checkout-page">
        <div className="checkout-layout">
          <div className="skeleton-card"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-copy" /></div>
          <div className="skeleton-card"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-copy" /></div>
        </div>
      </div>
    );
  }

  if (redirecting) {
    return (
      <div className="container page-shell checkout-transition" role="status" aria-live="polite">
        <LoaderCircle className="spin" aria-hidden="true" />
        <h1>Abrindo a confirmação do pedido</h1>
        <p>Seu carrinho já foi atualizado com segurança.</p>
      </div>
    );
  }

  if (!lines.length) {
    return (
      <div className="container page-shell checkout-page">
        <div className="empty-state cart-empty-state">
          <span className="empty-state-icon"><ShoppingBag /></span>
          <h1>Seu carrinho está vazio</h1>
          <p>Adicione um produto antes de iniciar o checkout.</p>
          <Link className="primary-button" href="/produtos">Ver produtos</Link>
        </div>
      </div>
    );
  }

  if (!selectedLines.length) {
    return (
      <div className="container page-shell checkout-page">
        <div className="empty-state cart-empty-state">
          <span className="empty-state-icon"><ShoppingBag /></span>
          <h1>Nenhum produto selecionado</h1>
          <p>Seus produtos continuam salvos. Selecione o que deseja comprar agora.</p>
          <Link className="primary-button" href="/carrinho">Voltar ao carrinho</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container page-shell checkout-page">
      <nav className="breadcrumbs" aria-label="Navegação estrutural">
        <Link href="/carrinho">Carrinho</Link><span>/</span><span>Checkout</span>
      </nav>
      <header className="checkout-heading">
        <h1>Checkout</h1>
        <Link className="checkout-review-cart" href="/carrinho">
          Voltar ao carrinho
        </Link>
      </header>

      <form
        ref={formRef}
        className="checkout-layout"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <div className="checkout-form-column">
          <section className="checkout-section" aria-labelledby="checkout-identification-title">
            <h2 id="checkout-identification-title">Identificação</h2>
            <div className="form-grid checkout-identification-grid">
              <div className="field checkout-name-field">
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
                {fieldErrors.email && (
                  <p className="field-error" id="checkout-email-error" role="alert">
                    {fieldErrors.email}
                  </p>
                )}
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
                {fieldErrors.phone && (
                  <p className="field-error" id="checkout-phone-error" role="alert">
                    {fieldErrors.phone}
                  </p>
                )}
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
                {fieldErrors.cpf && (
                  <p className="field-error" id="checkout-cpf-error" role="alert">
                    {fieldErrors.cpf}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="checkout-section" aria-labelledby="checkout-address-title">
            <h2 id="checkout-address-title">Endereço de entrega</h2>
            {savedAddresses.length ? (
              <div className="checkout-saved-addresses">
                <label htmlFor="savedAddress">Usar endereço salvo</label>
                <select
                  id="savedAddress"
                  defaultValue={
                    (savedAddresses.find((address) => address.isDefault) ?? savedAddresses[0])?.id
                  }
                  onChange={(event) => {
                    const selected = savedAddresses.find(
                      (address) => address.id === event.target.value
                    );
                    if (selected) applyAddress(selected);
                  }}
                >
                  {savedAddresses.map((address) => (
                    <option value={address.id} key={address.id}>
                      {address.label}
                    </option>
                  ))}
                </select>
                <Link href="/minha-conta/enderecos?returnTo=/checkout">Gerenciar endereços</Link>
              </div>
            ) : null}
            <div className="form-grid address-grid">
              <div className="field address-postal-field">
                <label htmlFor="postalCode">CEP</label>
                <input
                  id="postalCode"
                  name="postalCode"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={9}
                  onInput={(event) => {
                    event.currentTarget.value = formatPostalCode(event.currentTarget.value);
                  }}
                  required
                  placeholder="00000-000"
                />
              </div>
              <div className="field field-street address-street-field">
                <label htmlFor="street">Endereço</label>
                <input id="street" name="street" autoComplete="address-line1" maxLength={160} required />
              </div>
              <div className="field address-number-field">
                <label htmlFor="number">Número</label>
                <input id="number" name="number" maxLength={20} required />
              </div>
              <div className="field address-complement-field">
                <label htmlFor="complement">
                  Complemento <span className="optional-label">(opcional)</span>
                </label>
                <input
                  id="complement"
                  name="complement"
                  autoComplete="address-line2"
                  maxLength={120}
                />
              </div>
              <div className="field address-district-field">
                <label htmlFor="district">Bairro</label>
                <input id="district" name="district" maxLength={100} required />
              </div>
              <div className="field address-city-field">
                <label htmlFor="city">Cidade</label>
                <input id="city" name="city" autoComplete="address-level2" maxLength={100} required />
              </div>
              <div className="field address-state-field">
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

          <section className="checkout-section" aria-labelledby="checkout-delivery-title">
            <h2 id="checkout-delivery-title">Entrega</h2>
            <p className="checkout-simple-status" role="status">Informe o CEP para calcular.</p>
          </section>

          <section className="checkout-section" aria-labelledby="checkout-payment-title">
            <h2 id="checkout-payment-title">Pagamento</h2>
            <p className="checkout-simple-status">
              Valores e disponibilidade serão confirmados antes do pagamento.
            </p>
          </section>

          {message && (
            <p className="form-message" id="checkout-form-message" role="alert">
              {message}
            </p>
          )}
        </div>

        <div className="checkout-order-column">
          <section className="checkout-order-products" aria-labelledby="checkout-products-title">
            <header className="checkout-order-heading">
              <h2 id="checkout-products-title">Produtos</h2>
              <span>{selectedLines.length} {selectedLines.length === 1 ? "item" : "itens"}</span>
            </header>
            <CheckoutProducts lines={selectedLines} />
          </section>

          <aside className="checkout-summary" aria-labelledby="checkout-summary-title">
            <h2 id="checkout-summary-title">Resumo final</h2>
            <CheckoutTotals subtotal={subtotal} />
            <button
              ref={submitButtonRef}
              className="primary-button full-button checkout-button"
              type="submit"
              disabled={loading}
              aria-busy={loading}
              aria-describedby={message ? "checkout-form-message" : undefined}
            >
              {loading ? <LoaderCircle className="spin" /> : <LockKeyhole />}
              {loading ? "Validando pedido…" : "Confirmar e pagar"}
            </button>
          </aside>
        </div>
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
