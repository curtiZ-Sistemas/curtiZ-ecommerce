"use client";

import { calculateSubtotal, formatBRL, type CartLine } from "@curtiz/domain";
import { FIXED_SHIPPING_IN_CENTS } from "@curtiz/integrations";
import { LoaderCircle, LockKeyhole, ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useCart } from "@/components/cart-provider";
import { MercadoPagoPaymentBrick } from "@/components/mercadopago-payment-brick";
import { normalizeOptionalCouponCode } from "@/lib/checkout-flow";
import {
  readMercadoPagoBrickSession,
  type MercadoPagoBrickSession
} from "@/lib/mercadopago-brick-config";
import { isUnknownRecord } from "@/lib/unknown-data";
import {
  CPF_FORMATTED_MAX_LENGTH,
  CUSTOMER_EMAIL_MAX_LENGTH,
  formatBrazilianPhone,
  formatCpf,
  formatPostalCode,
  isValidBrazilianPhone,
  isValidCpf,
  isValidCustomerEmail,
  phoneDigits,
  PHONE_FORMATTED_MAX_LENGTH,
  sanitizeCpf
} from "@/lib/personal-data";
import { trackIntelligence } from "../../lib/intelligence-client";

const states = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO"
];

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
  recipientName?: string;
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

function CheckoutTotals({ subtotal, discountInCents = 0, couponName = "" }: {
  subtotal: number;
  discountInCents?: number;
  couponName?: string;
}) {
  return (
    <div className="checkout-totals">
      <div className="summary-line">
        <span>Subtotal</span>
        <strong>{formatBRL(subtotal)}</strong>
      </div>
      <div className="summary-line">
        <span>Entrega</span>
        <strong>{formatBRL(FIXED_SHIPPING_IN_CENTS)}</strong>
      </div>
      {discountInCents > 0 ? <div className="summary-line">
        <span>Cupom {couponName}</span>
        <strong>-{formatBRL(discountInCents)}</strong>
      </div> : null}
      <div className="summary-line summary-total">
        <span>Total</span>
        <strong>{formatBRL(subtotal - discountInCents + FIXED_SHIPPING_IN_CENTS)}</strong>
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
  const [paymentSession, setPaymentSession] = useState<MercadoPagoBrickSession | null>(null);
  const [formComplete, setFormComplete] = useState(false);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const closeDialogRef = useRef<HTMLButtonElement>(null);
  const paymentDialogRef = useRef<HTMLElement>(null);
  const idempotencyKeyRef = useRef("");
  const formRef = useRef<HTMLFormElement>(null);
  const trackedCheckoutRef = useRef(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [expandedAddressId, setExpandedAddressId] = useState("");
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [cpfLastFour, setCpfLastFour] = useState("");
  const [coupon, setCoupon] = useState({ code: "", name: "", discountInCents: 0 });
  const [couponMessage, setCouponMessage] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PersonalField, string>>>({});
  const subtotal = calculateSubtotal(selectedLines);

  const applyCoupon = async () => {
    const codeField = formRef.current?.elements.namedItem("couponCode");
    const postalField = formRef.current?.elements.namedItem("postalCode");
    const code = codeField instanceof HTMLInputElement ? codeField.value.trim() : "";
    if (!code) {
      setCoupon({ code: "", name: "", discountInCents: 0 });
      setCouponMessage("Informe o código do cupom.");
      return;
    }
    setCouponLoading(true);
    setCouponMessage("");
    try {
      const response = await fetch("/api/checkout/coupon", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          postalCode: postalField instanceof HTMLInputElement ? postalField.value : "",
          lines: selectedLines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            quantity: line.quantity
          }))
        })
      });
      const result = await response.json() as { name?: string; discountInCents?: number; message?: string };
      if (!response.ok || !result.discountInCents) throw new Error(result.message);
      setCoupon({ code, name: result.name ?? code, discountInCents: result.discountInCents });
      setCouponMessage("Cupom aplicado.");
    } catch (error) {
      setCoupon({ code: "", name: "", discountInCents: 0 });
      setCouponMessage(error instanceof Error && error.message ? error.message : "Não foi possível validar o cupom.");
    } finally {
      setCouponLoading(false);
    }
  };

  const focusSubmitAction = useCallback(() => {
    submitButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem("curtiz-checkout-idempotency");
    const key = stored && /^[0-9a-f-]{36}$/iu.test(stored) ? stored : crypto.randomUUID();
    sessionStorage.setItem("curtiz-checkout-idempotency", key);
    idempotencyKeyRef.current = key;
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
    setCoupon({ code: "", name: "", discountInCents: 0 });
    setCouponMessage("");
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
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement)
        field.value = value;
    }
  }, []);

  useEffect(() => {
    if (!hydrated || !selectedLines.length) return;
    const controller = new AbortController();
    void fetch("/api/checkout/profile", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          profile?: { fullName?: string; email?: string; phone?: string; cpfLastFour?: string } | null;
          addresses?: SavedAddress[];
        };
      })
      .then((payload) => {
        if (!payload) return;
        setFieldIfEmpty("name", payload.profile?.fullName ?? "");
        setFieldIfEmpty("email", payload.profile?.email ?? "");
        setFieldIfEmpty("phone", formatBrazilianPhone(payload.profile?.phone ?? ""));
        setCpfLastFour(payload.profile?.cpfLastFour ?? "");
        const addresses = Array.isArray(payload.addresses) ? payload.addresses : [];
        setSavedAddresses(addresses);
        const preferred = addresses.find((address) => address.isDefault) ?? addresses[0];
        if (preferred) { setSelectedAddressId(preferred.id); applyAddress(preferred); }
        window.requestAnimationFrame(() => setFormComplete(formRef.current?.checkValidity() ?? false));
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
        "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])"
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

  const completePayment = useCallback((
    status: "approved" | "pending" | "rejected" | "cancelled" | "error",
    _orderCode: string,
    orderId: string
  ) => {
    sessionStorage.removeItem("curtiz-checkout-idempotency");
    if (status === "approved") {
      removeMany(selectedLines.map((line) => line.variantId));
    } else if (status === "pending" && orderId) {
      sessionStorage.setItem("curtiz-pending-order-cleanup", orderId);
    }
    setRedirecting(true);
    router.push(`/pedido/${encodeURIComponent(orderId)}/pagamento`);
  }, [removeMany, router, selectedLines]);

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
    const couponCode = normalizeOptionalCouponCode(form.get("couponCode"));
    const errors: Partial<Record<PersonalField, string>> = {};
    if (!isValidCustomerEmail(email)) errors.email = "Informe um e-mail válido.";
    if (!isValidBrazilianPhone(phone)) errors.phone = "Informe um telefone válido com DDD.";
    if (!cpfLastFour && !isValidCpf(cpf)) errors.cpf = "Informe um CPF válido.";
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
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
      sessionStorage.setItem("curtiz-checkout-idempotency", idempotencyKeyRef.current);
    }

    try {
      const selectedAddress = savedAddresses.find((address) => address.id === selectedAddressId);
      if (!selectedAddress || editingAddressId) {
        const baseLabel = formString("addressLabel") || selectedAddress?.label.replace(/\s+\d+$/u, "") || "Casa";
        const addressResponse = await fetch("/api/customer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "address_save",
            id: editingAddressId && editingAddressId !== "new" ? editingAddressId : null,
            label: editingAddressId === "new" ? baseLabel : selectedAddress?.label ?? baseLabel,
            recipientName: editingAddressId ? formString("name") : selectedAddress?.recipientName ?? formString("name"),
            postalCode: formString("postalCode"), street: formString("street"),
            number: formString("number"), complement: formString("complement"), district: formString("district"),
            city: formString("city"), state: formString("state"), isDefault: true }
          )
        });
        if (!addressResponse.ok) {
          const addressResult = await addressResponse.json() as { message?: string };
          setMessage(addressResult.message ?? "Não foi possível salvar o endereço.");
          return;
        }
      }
      const checkout = {
        ...(couponCode ? { couponCode } : {}),
        customer: {
          name: formString("name"), email, phone: phoneDigits(phone), cpf: sanitizeCpf(cpf)
        },
        address: {
          postalCode: formString("postalCode"), street: formString("street"), number: formString("number"),
          complement: formString("complement"), district: formString("district"), city: formString("city"), state: formString("state")
        },
        lines: selectedLines.map((line) => ({
          productId: line.productId, variantId: line.variantId, color: line.color,
          size: line.size, quantity: line.quantity
        }))
      };
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempotencyKeyRef.current,
          ...checkout
        })
      });
      const result: unknown = await response.json();
      const resultRecord = isUnknownRecord(result) ? result : {};
      const redirectTo = typeof resultRecord.redirectTo === "string" ? resultRecord.redirectTo : "";
      const code = typeof resultRecord.code === "string" ? resultRecord.code : "";
      const resultMessage = typeof resultRecord.message === "string" ? resultRecord.message : "";
      if (response.status === 401 && redirectTo) {
        router.replace(redirectTo);
        return;
      }
      if (code === "PAYMENT_UNAVAILABLE") {
        const requestId = response.headers.get("x-request-id") ?? "";
        setSupportCode(requestId ? requestId.slice(0, 8).toUpperCase() : "");
        setPaymentUnavailable(true);
        return;
      }
      if (
        response.ok &&
        /^\/pedido\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/pagamento$/iu.test(redirectTo)
      ) {
        router.replace(redirectTo);
        return;
      }
      const session = readMercadoPagoBrickSession(
        result,
        {
          idempotencyKey: idempotencyKeyRef.current,
          email,
          cpf: sanitizeCpf(cpf),
          checkout
        },
        FIXED_SHIPPING_IN_CENTS
      );
      if (!session) {
        setMessage(resultMessage || "Não foi possível iniciar o pagamento.");
        return;
      }
      setPaymentSession(session);
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
          <div className="skeleton-card">
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-copy" />
          </div>
          <div className="skeleton-card">
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-copy" />
          </div>
        </div>
      </div>
    );
  }

  if (redirecting) {
    return (
      <div className="container page-shell checkout-transition" role="status" aria-live="polite">
        <LoaderCircle className="spin" width={24} height={24} aria-hidden="true" />
        <h1>Abrindo a confirmação do pedido</h1>
        <p>Seu carrinho já foi atualizado com segurança.</p>
      </div>
    );
  }

  if (!lines.length) {
    return (
      <div className="container page-shell checkout-page">
        <div className="empty-state cart-empty-state">
          <span className="empty-state-icon">
            <ShoppingBag width={24} height={24} />
          </span>
          <h1>Seu carrinho está vazio</h1>
          <p>Adicione um produto antes de iniciar o checkout.</p>
          <Link className="primary-button" href="/produtos">
            Ver produtos
          </Link>
        </div>
      </div>
    );
  }

  if (!selectedLines.length) {
    return (
      <div className="container page-shell checkout-page">
        <div className="empty-state cart-empty-state">
          <span className="empty-state-icon">
            <ShoppingBag width={24} height={24} />
          </span>
          <h1>Nenhum produto selecionado</h1>
          <p>Seus produtos continuam salvos. Selecione o que deseja comprar agora.</p>
          <Link className="primary-button" href="/carrinho">
            Voltar ao carrinho
          </Link>
        </div>
      </div>
    );
  }

  if (paymentSession) {
    return (
      <div className="container page-shell checkout-page checkout-bricks-page">
        <header className="checkout-heading">
          <div><p className="eyebrow">Escolha como pagar</p></div>
        </header>
        <div className="checkout-layout">
          <MercadoPagoPaymentBrick session={paymentSession} onComplete={completePayment} />
          <aside className="checkout-summary" aria-labelledby="checkout-brick-summary-title">
            <h2 id="checkout-brick-summary-title">Resumo do pedido</h2>
            <CheckoutProducts lines={selectedLines} />
            <div className="summary-line">
              <span>Subtotal</span>
              <strong>{formatBRL(paymentSession.subtotalInCents)}</strong>
            </div>
            <div className="summary-line">
              <span>Entrega</span>
              <strong>{formatBRL(paymentSession.shippingInCents)}</strong>
            </div>
            {paymentSession.discountInCents > 0 ? <div className="summary-line">
              <span>Cupom {paymentSession.couponName}</span>
              <strong>-{formatBRL(paymentSession.discountInCents)}</strong>
            </div> : null}
            <div className="summary-line summary-total">
              <span>Total confirmado</span>
              <strong>{formatBRL(paymentSession.amountInCents)}</strong>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="container page-shell checkout-page">
      <nav className="breadcrumbs" aria-label="Navegação estrutural">
        <Link href="/carrinho">Carrinho</Link>
        <span>/</span>
        <span>Checkout</span>
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
        onInput={(event) => setFormComplete(event.currentTarget.checkValidity())}
        onChange={(event) => setFormComplete(event.currentTarget.checkValidity())}
      >
        <div className="checkout-form-column">
          <section className="checkout-section" aria-labelledby="checkout-identification-title">
            <h2 id="checkout-identification-title">Identificação</h2>
            <div className="form-grid checkout-identification-grid">
              <div className="field checkout-name-field">
                <label htmlFor="name">Nome completo</label>
                <input
                  id="name"
                  name="name"
                  autoComplete="name"
                  required
                  minLength={3}
                  maxLength={120}
                  placeholder="Nome e sobrenome"
                />
              </div>
              <div className="field">
                <label htmlFor="email">E-mail</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
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
                  inputMode="tel"
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
                {cpfLastFour ? <div className="customer-readonly">***.***.***-{cpfLastFour}<input type="hidden" id="cpf" name="cpf" value="" /></div> : <input
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
                />}
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
                {savedAddresses.map((address) => <article className={`checkout-address-card${selectedAddressId === address.id ? " selected" : ""}`} key={address.id}>
                  <div className="checkout-address-card-heading">
                    <label><input type="radio" name="selectedAddress" value={address.id} checked={selectedAddressId === address.id}
                      onChange={() => { setSelectedAddressId(address.id); setEditingAddressId(null); applyAddress(address); }} />
                      <span><strong>{address.label}</strong><small>{address.street}, {address.number}</small></span></label>
                    <button type="button" aria-expanded={expandedAddressId === address.id} aria-label={`${expandedAddressId === address.id ? "Recolher" : "Expandir"} endereço ${address.label}`}
                      onClick={() => setExpandedAddressId((current) => current === address.id ? "" : address.id)}>⌄</button>
                  </div>
                  {expandedAddressId === address.id ? <div className="checkout-address-details">
                    <p>{address.recipientName}<br />{address.street}, {address.number}<br />{address.complement}<br />{address.district}<br />{address.city} - {address.state}<br />CEP {address.postalCode.slice(0, 2)}***-***</p>
                    <div><button type="button" onClick={() => { setSelectedAddressId(address.id); setEditingAddressId(address.id); applyAddress(address); }}>Editar</button>
                      <button type="button" onClick={() => { void (async () => { if (!window.confirm("Excluir este endereço?")) return; const response = await fetch("/api/customer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "address_delete", id: address.id }) }); if (response.ok) { const remaining = savedAddresses.filter((item) => item.id !== address.id); setSavedAddresses(remaining); const next = remaining[0]; setSelectedAddressId(next?.id ?? ""); if (next) applyAddress(next); } else setMessage("Não foi possível excluir o endereço."); })(); }}>Excluir</button></div>
                  </div> : null}
                </article>)}
                {savedAddresses.length < 3 && editingAddressId !== "new" ? <button className="customer-link-button" type="button" onClick={() => setEditingAddressId("new")}>+ Adicionar outro endereço</button> : null}
              </div>
            ) : null}
            {savedAddresses.length && !editingAddressId ? (() => {
              const address = savedAddresses.find((item) => item.id === selectedAddressId);
              return address ? <>{Object.entries({ postalCode: address.postalCode, street: address.street, number: address.number,
                complement: address.complement, district: address.district, city: address.city, state: address.state })
                .map(([name, value]) => <input type="hidden" name={name} value={value} key={name} />)}</> : null;
            })() : null}
            {(!savedAddresses.length || editingAddressId) ? <><div className="checkout-address-labels"><span>Salvar este endereço como</span>
              <label><input type="radio" name="addressLabel" value="Casa" defaultChecked /> Casa</label>
              <label><input type="radio" name="addressLabel" value="Trabalho" /> Trabalho</label></div>
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
                <input
                  id="street"
                  name="street"
                  autoComplete="address-line1"
                  maxLength={160}
                  required
                />
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
                <input
                  id="district"
                  name="district"
                  autoComplete="address-level3"
                  maxLength={100}
                  required
                />
              </div>
              <div className="field address-city-field">
                <label htmlFor="city">Cidade</label>
                <input
                  id="city"
                  name="city"
                  autoComplete="address-level2"
                  maxLength={100}
                  required
                />
              </div>
              <div className="field address-state-field">
                <label htmlFor="state">Estado</label>
                <select
                  id="state"
                  name="state"
                  autoComplete="address-level1"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    Selecione
                  </option>
                  {states.map((state) => (
                    <option key={state}>{state}</option>
                  ))}
                </select>
              </div>
            </div></> : null}
          </section>

          <section className="checkout-section" aria-labelledby="checkout-delivery-title">
            <h2 id="checkout-delivery-title">Entrega</h2>
            <div className="summary-line">
              <span>Entrega padrão</span>
              <strong>{formatBRL(FIXED_SHIPPING_IN_CENTS)}</strong>
            </div>
            <p className="checkout-simple-status">Prazo informado após o envio.</p>
          </section>

          <section className="checkout-section" aria-labelledby="checkout-payment-title">
            <div className="checkout-payment-heading">
              <h2 id="checkout-payment-title">Pagamento</h2>
            </div>
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
              <span>
                {selectedLines.length} {selectedLines.length === 1 ? "item" : "itens"}
              </span>
            </header>
            <CheckoutProducts lines={selectedLines} />
          </section>

          <aside className="checkout-summary" aria-labelledby="checkout-summary-title">
            <h2 id="checkout-summary-title">Resumo final</h2>
            <CheckoutTotals subtotal={subtotal} discountInCents={coupon.discountInCents} couponName={coupon.name} />
            <div className="field checkout-coupon-field">
              <label htmlFor="couponCode">Tem um cupom?</label>
              <div><input id="couponCode" name="couponCode" maxLength={40} autoCapitalize="characters" placeholder="CÓDIGO DO CUPOM"
                onChange={() => { setCoupon({ code: "", name: "", discountInCents: 0 }); setCouponMessage(""); }} />
                <button className="secondary-button" type="button" disabled={couponLoading} onClick={() => void applyCoupon()}>
                  {couponLoading ? "Validando…" : "Aplicar"}
                </button></div>
              {couponMessage ? <small role="status">{couponMessage}</small> : null}
            </div>
            <button
              ref={submitButtonRef}
              className="primary-button full-button checkout-button"
              type="submit"
              disabled={loading || !formComplete}
              aria-busy={loading}
              aria-describedby={message ? "checkout-form-message" : undefined}
            >
              {loading ? <LoaderCircle className="spin" width={24} height={24} /> : null}
              {loading ? "Validando pedido…" : "Continuar para pagamento"}
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
            <span className="empty-state-icon">
              <LockKeyhole width={24} height={24} />
            </span>
            <h2 id="payment-unavailable-title">Pagamento online indisponível no momento</h2>
            <p id="payment-unavailable-description">
              Não foi possível concluir o pagamento. Nenhuma cobrança foi realizada.
            </p>
            {supportCode && <small>Código para suporte: {supportCode}</small>}
            <div className="checkout-dialog-actions">
              <button
                ref={closeDialogRef}
                className="primary-button"
                type="button"
                onClick={closePaymentDialog}
              >
                Voltar ao checkout
              </button>
              <Link className="secondary-button" href="/produtos">
                Continuar comprando
              </Link>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
