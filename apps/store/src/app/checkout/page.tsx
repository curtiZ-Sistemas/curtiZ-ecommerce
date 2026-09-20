"use client";

import { calculateSubtotal, formatBRL, type CartLine } from "@curtiz/domain";
import { BriefcaseBusiness, ChevronDown, House, LoaderCircle, LockKeyhole, Plus, ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useCart } from "@/components/cart-provider";
import { CustomerCpfField } from "@/components/customer-cpf-field";
import { MercadoPagoPaymentBrick } from "@/components/mercadopago-payment-brick";
import { checkoutMissingFields, normalizeOptionalCouponCode, type CheckoutRequiredField } from "@/lib/checkout-flow";
import {
  readMercadoPagoBrickSession,
  type MercadoPagoBrickSession
} from "@/lib/mercadopago-brick-config";
import { isUnknownRecord, readString } from "@/lib/unknown-data";
import {
  CPF_FORMATTED_MAX_LENGTH,
  CUSTOMER_EMAIL_MAX_LENGTH,
  formatBrazilianPhone,
  formatCpf,
  formatPostalCode,
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

const formValue = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

const checkoutReadiness = (form: HTMLFormElement, cpfConfigured: boolean, itemCount: number) => {
  const data = new FormData(form);
  return checkoutMissingFields({
    customer: {
      name: formValue(data, "name"), email: formValue(data, "email"),
      phone: formValue(data, "phone"), cpf: formValue(data, "cpf")
    },
    address: {
      postalCode: formValue(data, "postalCode"), street: formValue(data, "street"),
      number: formValue(data, "number"), complement: formValue(data, "complement"),
      district: formValue(data, "district"), city: formValue(data, "city"), state: formValue(data, "state")
    },
    cpfConfigured,
    itemCount
  });
};

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

const addressBaseLabel = (label: string) => label.replace(/\s+\d+$/u, "");

const nextAddressLabel = (addresses: SavedAddress[], baseLabel: string) => {
  const suffixes = addresses
    .filter((address) => addressBaseLabel(address.label) === baseLabel)
    .map((address) => {
      const match = /\s+(\d+)$/u.exec(address.label);
      return match?.[1] ? Number(match[1]) : 1;
    });
  const suffix = (suffixes.length ? Math.max(...suffixes) : 0) + 1;
  return suffix === 1 ? baseLabel : `${baseLabel} ${suffix}`;
};

const maskPhone = (phone: string) => {
  const digits = phoneDigits(phone);
  return digits.length >= 4 ? `(**) *****-${digits.slice(-4)}` : "";
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

type ShippingQuoteOption = {
  id: string;
  service: string;
  carrier: string;
  amountInCents: number;
  estimatedDays: number | null;
  expiresAt: string | null;
};

function CheckoutTotals({ subtotal, shippingInCents, discountInCents = 0, couponName = "" }: {
  subtotal: number;
  shippingInCents: number | null;
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
        <strong>{shippingInCents === null ? "A calcular" : formatBRL(shippingInCents)}</strong>
      </div>
      {discountInCents > 0 ? <div className="summary-line">
        <span>Cupom {couponName}</span>
        <strong>-{formatBRL(discountInCents)}</strong>
      </div> : null}
      <div className="summary-line summary-total">
        <span>Total</span>
        <strong>{shippingInCents === null ? "—" : formatBRL(subtotal - discountInCents + shippingInCents)}</strong>
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
  const submitInFlightRef = useRef(false);
  const checkoutRecoveryRef = useRef<MercadoPagoBrickSession["checkout"]>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const trackedCheckoutRef = useRef(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [expandedAddressId, setExpandedAddressId] = useState("");
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addressLabel, setAddressLabel] = useState("Casa");
  const [cpfConfigured, setCpfConfigured] = useState(false);
  const [cpfLastFour, setCpfLastFour] = useState("");
  const [editingCpf, setEditingCpf] = useState(false);
  const [profilePhone, setProfilePhone] = useState("");
  const [coupon, setCoupon] = useState({ code: "", name: "", discountInCents: 0 });
  const [couponMessage, setCouponMessage] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [shippingQuotes, setShippingQuotes] = useState<ShippingQuoteOption[]>([]);
  const [selectedShippingQuoteId, setSelectedShippingQuoteId] = useState("");
  const [shippingState, setShippingState] = useState<"waiting" | "loading" | "options" | "empty" | "error">("waiting");
  const [shippingMessage, setShippingMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PersonalField, string>>>({});
  const subtotal = calculateSubtotal(selectedLines);
  const selectedLineFingerprint = selectedLines.map((line) => `${line.variantId}:${line.quantity}`).sort().join("|");
  const selectedShippingQuote = shippingQuotes.find((quote) => quote.id === selectedShippingQuoteId) ?? null;

  const resetShippingQuote = useCallback(() => {
    setShippingQuotes([]);
    setSelectedShippingQuoteId("");
    setShippingState("waiting");
    setShippingMessage("");
  }, []);

  const calculateShipping = async () => {
    const postalField = formRef.current?.elements.namedItem("postalCode");
    const postalCode = postalField instanceof HTMLInputElement ? postalField.value : "";
    if (postalCode.replace(/\D/gu, "").length !== 8) {
      setShippingState("waiting");
      setShippingMessage("Informe um CEP válido para calcular o frete.");
      if (postalField instanceof HTMLInputElement) postalField.focus();
      return;
    }
    setShippingState("loading");
    setShippingMessage("");
    setSelectedShippingQuoteId("");
    try {
      const response = await fetch("/api/shipping/quote", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ postalCode, lines: selectedLines.map((line) => ({
          productId: line.productId, variantId: line.variantId, quantity: line.quantity
        })) }) });
      const result: unknown = await response.json();
      const record = isUnknownRecord(result) ? result : {};
      const quotes = Array.isArray(record.quotes) ? record.quotes.flatMap((entry): ShippingQuoteOption[] => {
        if (!isUnknownRecord(entry) || typeof entry.id !== "string" || typeof entry.service !== "string"
          || typeof entry.carrier !== "string" || typeof entry.amountInCents !== "number"
          || !Number.isSafeInteger(entry.amountInCents) || entry.amountInCents < 0) return [];
        return [{ id: entry.id, service: entry.service, carrier: entry.carrier, amountInCents: entry.amountInCents,
          estimatedDays: typeof entry.estimatedDays === "number" ? entry.estimatedDays : null,
          expiresAt: typeof entry.expiresAt === "string" ? entry.expiresAt : null }];
      }) : [];
      if (!response.ok) {
        setShippingState("error");
        setShippingMessage(typeof record.message === "string" ? record.message : "Não foi possível calcular o frete. Tente novamente.");
        return;
      }
      setShippingQuotes(quotes);
      setShippingState(quotes.length ? "options" : "empty");
      setShippingMessage(quotes.length ? "Selecione uma opção de entrega." : "Nenhuma opção de entrega está disponível para este CEP.");
      if (quotes.length === 1 && quotes[0]) setSelectedShippingQuoteId(quotes[0].id);
    } catch {
      setShippingState("error");
      setShippingMessage("Não foi possível calcular o frete. Tente novamente.");
    }
  };

  const applyCoupon = async () => {
    const codeField = formRef.current?.elements.namedItem("couponCode");
    const postalField = formRef.current?.elements.namedItem("postalCode");
    const code = codeField instanceof HTMLInputElement ? codeField.value.trim() : "";
    if (!code) {
      setCoupon({ code: "", name: "", discountInCents: 0 });
      setCouponMessage("");
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
    const key = stored && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(stored)
      ? stored : crypto.randomUUID();
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

  const updateFormReadiness = useCallback((form = formRef.current) => {
    if (!form) return;
    setFormComplete(!editingCpf && checkoutReadiness(form, cpfConfigured, selectedLines.length).length === 0);
  }, [cpfConfigured, editingCpf, selectedLines.length]);

  const applyAddress = useCallback((address: SavedAddress) => {
    setCoupon({ code: "", name: "", discountInCents: 0 });
    setCouponMessage("");
    resetShippingQuote();
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
  }, [resetShippingQuote]);

  useEffect(() => { resetShippingQuote(); }, [resetShippingQuote, selectedLineFingerprint]);

  useEffect(() => {
    if (paymentSession || !formRef.current) return;
    const previousCheckout = checkoutRecoveryRef.current;
    if (previousCheckout) {
      const values = { ...previousCheckout.customer, ...previousCheckout.address,
        couponCode: previousCheckout.couponCode ?? "" };
      for (const [name, value] of Object.entries(values)) {
        const field = formRef.current.elements.namedItem(name);
        if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = value;
      }
      checkoutRecoveryRef.current = null;
      submitButtonRef.current?.focus();
    }
    updateFormReadiness(formRef.current);
  }, [paymentSession, cpfConfigured, profilePhone, selectedAddressId, editingAddressId, hydrated, updateFormReadiness]);

  useEffect(() => {
    if (!editingAddressId || editingAddressId === "new") return;
    const address = savedAddresses.find((item) => item.id === editingAddressId);
    if (!address) return;
    setAddressLabel(addressBaseLabel(address.label));
    applyAddress(address);
  }, [applyAddress, editingAddressId, savedAddresses]);

  useEffect(() => {
    if (!hydrated || !selectedLines.length) return;
    const controller = new AbortController();
    void fetch("/api/checkout/profile", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          profile?: { fullName?: string; email?: string; phone?: string; cpfConfigured?: boolean; cpfLastFour?: string } | null;
          addresses?: SavedAddress[];
        };
      })
      .then((payload) => {
        if (!payload) return;
        setFieldIfEmpty("name", payload.profile?.fullName ?? "");
        setFieldIfEmpty("email", payload.profile?.email ?? "");
        setFieldIfEmpty("phone", formatBrazilianPhone(payload.profile?.phone ?? ""));
        setProfilePhone(payload.profile?.phone ?? "");
        const configured = payload.profile?.cpfConfigured === true
          && /^\d{4}$/u.test(payload.profile.cpfLastFour ?? "");
        setCpfConfigured(configured);
        setCpfLastFour(configured ? payload.profile?.cpfLastFour ?? "" : "");
        const addresses = Array.isArray(payload.addresses) ? payload.addresses : [];
        setSavedAddresses(addresses);
        const preferred = addresses.find((address) => address.isDefault) ?? addresses[0];
        if (preferred) { setSelectedAddressId(preferred.id); applyAddress(preferred); }
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
    if (submitInFlightRef.current || loading || paymentSession) return;
    if (editingCpf) { setMessage("Salve ou cancele a alteração do CPF antes de continuar."); return; }
    if (!selectedLines.length) {
      setMessage("Selecione pelo menos um produto no carrinho antes de finalizar.");
      return;
    }

    setMessage("");
    const form = new FormData(event.currentTarget);
    const formString = (name: string) => formValue(form, name);
    const email = formString("email");
    const phone = formString("phone");
    const cpf = formString("cpf");
    const couponCode = normalizeOptionalCouponCode(form.get("couponCode"));
    const missingFields = checkoutReadiness(event.currentTarget, cpfConfigured, selectedLines.length);
    const errors: Partial<Record<PersonalField, string>> = {};
    if (missingFields.includes("email")) errors.email = "Informe um e-mail válido.";
    if (missingFields.includes("phone")) errors.phone = "Informe um telefone válido com DDD.";
    if (missingFields.includes("cpf")) errors.cpf = "Informe um CPF válido.";
    setFieldErrors(errors);
    const firstInvalid = missingFields[0];
    if (firstInvalid) {
      setMessage("Complete os dados obrigatórios antes de continuar.");
      const invalidField = formRef.current?.elements.namedItem(firstInvalid);
      if (invalidField instanceof HTMLElement) invalidField.focus();
      return;
    }
    if (!selectedShippingQuote) {
      setMessage("Calcule e selecione uma opção de frete antes de continuar.");
      return;
    }
    if (selectedShippingQuote.expiresAt && Date.parse(selectedShippingQuote.expiresAt) <= Date.now()) {
      resetShippingQuote();
      setShippingState("error");
      setShippingMessage("A cotação expirou. Calcule o frete novamente.");
      return;
    }

    submitInFlightRef.current = true;
    setLoading(true);
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
      sessionStorage.setItem("curtiz-checkout-idempotency", idempotencyKeyRef.current);
    }

    try {
      const selectedAddress = savedAddresses.find((address) => address.id === selectedAddressId);
      if (!selectedAddress || editingAddressId) {
        const baseLabel = formString("addressLabel") || selectedAddress?.label.replace(/\s+\d+$/u, "") || "Casa";
        const editingExisting = Boolean(editingAddressId && editingAddressId !== "new");
        const persistedLabel = editingExisting && selectedAddress
          ? addressBaseLabel(selectedAddress.label) === baseLabel
            ? selectedAddress.label
            : nextAddressLabel(savedAddresses.filter((address) => address.id !== selectedAddress.id), baseLabel)
          : baseLabel;
        const addressResponse = await fetch("/api/customer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "address_save",
            id: editingAddressId && editingAddressId !== "new" ? editingAddressId : null,
            label: persistedLabel,
            recipientName: formString("name"),
            postalCode: formString("postalCode"), street: formString("street"),
            number: formString("number"), complement: formString("complement"), district: formString("district"),
            city: formString("city"), state: formString("state"),
            isDefault: editingExisting ? selectedAddress?.isDefault === true : savedAddresses.length === 0 }
          )
        });
        if (!addressResponse.ok) {
          const addressResult = await addressResponse.json() as { message?: string };
          setMessage(addressResult.message ?? "Não foi possível salvar o endereço.");
          return;
        }
        const addressResult = await addressResponse.json() as { data?: unknown; address?: unknown };
        const savedId = typeof addressResult.data === "string" ? addressResult.data : "";
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(savedId)) {
          setMessage("O endereço foi salvo, mas não foi possível confirmar seu identificador.");
          return;
        }
        const savedAddress: SavedAddress = {
          id: savedId,
          label: editingExisting ? persistedLabel : nextAddressLabel(savedAddresses, baseLabel),
          recipientName: formString("name"),
          postalCode: formString("postalCode"),
          street: formString("street"),
          number: formString("number"),
          complement: formString("complement"),
          district: formString("district"),
          city: formString("city"),
          state: formString("state"),
          isDefault: editingExisting ? selectedAddress?.isDefault === true : savedAddresses.length === 0
        };
        if (isUnknownRecord(addressResult.address) && addressResult.address.id === savedId) {
          const persisted = addressResult.address;
          Object.assign(savedAddress, {
            label: readString(persisted, "label"), recipientName: readString(persisted, "recipient_name"),
            postalCode: readString(persisted, "postal_code"), street: readString(persisted, "street"),
            number: readString(persisted, "number"), complement: readString(persisted, "complement"),
            district: readString(persisted, "district"), city: readString(persisted, "city"),
            state: readString(persisted, "state"), isDefault: persisted.is_default === true
          });
        }
        setSavedAddresses((current) => [
          savedAddress,
          ...current.filter((address) => address.id !== savedId)
        ].map((address) => savedAddress.isDefault
          ? { ...address, isDefault: address.id === savedId } : address));
        setSelectedAddressId(savedId);
        setEditingAddressId(null);
      }
      const checkout = {
        ...(couponCode ? { couponCode } : {}),
        ...(selectedShippingQuote.id !== "fixed" ? { shippingQuoteId: selectedShippingQuote.id } : {}),
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
          ...(selectedShippingQuote.id !== "fixed" ? { shippingQuoteId: selectedShippingQuote.id } : {}),
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
      if (code === "CHECKOUT_INCOMPLETE") {
        const allowedFields: CheckoutRequiredField[] = [
          "name", "email", "phone", "cpf", "postalCode", "street", "number", "district", "city", "state", "items"
        ];
        const serverMissingFields = Array.isArray(resultRecord.missingFields)
          ? resultRecord.missingFields.filter((field): field is CheckoutRequiredField =>
            typeof field === "string" && allowedFields.includes(field as CheckoutRequiredField))
          : [];
        if (serverMissingFields.includes("cpf")) {
          setCpfConfigured(false);
          setCpfLastFour("");
          setFieldErrors((current) => ({ ...current, cpf: "Informe um CPF válido." }));
        }
        setMessage(resultMessage || "Complete os dados obrigatórios antes de continuar.");
        const firstMissing = serverMissingFields[0];
        if (firstMissing) window.requestAnimationFrame(() => {
          const field = formRef.current?.elements.namedItem(firstMissing);
          if (field instanceof HTMLElement) field.focus();
        });
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
          checkout: { ...checkout, customer: { ...checkout.customer, cpf: "" } }
        },
        selectedShippingQuote.amountInCents
      );
      if (!session) {
        setMessage(resultMessage || "Não foi possível iniciar o pagamento.");
        return;
      }
      if (cpf) {
        setCpfConfigured(true);
        setCpfLastFour(sanitizeCpf(cpf).slice(-4));
      }
      const cpfInput = formRef.current?.elements.namedItem("cpf");
      if (cpfInput instanceof HTMLInputElement) cpfInput.value = "";
      setPaymentSession(session);
    } catch {
      setMessage("Não foi possível conectar ao checkout. Seus itens continuam no carrinho.");
    } finally {
      submitInFlightRef.current = false;
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
          <MercadoPagoPaymentBrick session={paymentSession} onComplete={completePayment}
            onBack={() => {
              checkoutRecoveryRef.current = paymentSession.checkout;
              setPaymentSession(null);
              setMessage("");
            }}
            onReviewCheckout={(reason, code) => {
              checkoutRecoveryRef.current = paymentSession.checkout;
              if (code === "CUSTOMER_IDENTITY_REQUIRED" || code === "INVALID_CUSTOMER_CPF") setCpfLastFour("");
              setPaymentSession(null);
              setMessage(reason);
            }} />
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
        onInput={(event) => updateFormReadiness(event.currentTarget)}
        onChange={(event) => updateFormReadiness(event.currentTarget)}
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
                {!cpfConfigured && <label htmlFor="cpf">CPF para o pedido</label>}
                {cpfConfigured ? <>
                  <CustomerCpfField lastFour={cpfLastFour} onSaved={(lastFour) => {
                    setCpfConfigured(true); setCpfLastFour(lastFour);
                  }} onEditingChange={setEditingCpf} />
                  <input type="hidden" id="cpf" name="cpf" value="" />
                </> : <input
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
                      {addressBaseLabel(address.label) === "Trabalho" ? <BriefcaseBusiness aria-hidden="true" /> : <House aria-hidden="true" />}
                      <span><strong>{address.label}</strong><small>{address.street}, {address.number}</small></span></label>
                    {address.isDefault ? <span className="checkout-address-default">Padrão</span> : null}
                    <button className="checkout-address-toggle" type="button" aria-expanded={expandedAddressId === address.id}
                      aria-controls={`checkout-address-${address.id}`} aria-label={`${expandedAddressId === address.id ? "Recolher" : "Expandir"} endereço ${address.label}`}
                      onClick={() => setExpandedAddressId((current) => current === address.id ? "" : address.id)}><ChevronDown aria-hidden="true" /></button>
                  </div>
                  <div className="checkout-address-expansion" data-expanded={expandedAddressId === address.id}
                    id={`checkout-address-${address.id}`} inert={expandedAddressId !== address.id} aria-hidden={expandedAddressId !== address.id}>
                    <div className="checkout-address-expansion-inner"><div className="checkout-address-details">
                    {address.recipientName ? <p><span>Destinatário</span>{address.recipientName}</p> : null}
                    <p>{address.complement ? <>{address.complement}<br /></> : null}{address.district}<br />{address.city} / {address.state}</p>
                    <p>CEP {address.postalCode.slice(0, 2)}***-***{maskPhone(profilePhone) ? <><br />Telefone {maskPhone(profilePhone)}</> : null}</p>
                    <div className="checkout-address-actions"><button type="button" onClick={() => { setSelectedAddressId(address.id); setAddressLabel(addressBaseLabel(address.label)); setEditingAddressId(address.id); }}>Editar</button>
                      <button type="button" onClick={() => { void (async () => {
                        if (!window.confirm("Excluir este endereço?")) return;
                        const response = await fetch("/api/customer", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ action: "address_delete", id: address.id })
                        });
                        if (!response.ok) {
                          setMessage("Não foi possível excluir o endereço.");
                          return;
                        }
                        const profileResponse = await fetch("/api/checkout/profile", { cache: "no-store" });
                        const profile = profileResponse.ok
                          ? await profileResponse.json() as { addresses?: SavedAddress[] }
                          : null;
                        const remaining = Array.isArray(profile?.addresses)
                          ? profile.addresses
                          : savedAddresses.filter((item) => item.id !== address.id);
                        setSavedAddresses(remaining);
                        const next = remaining.find((item) => item.id === selectedAddressId)
                          ?? remaining.find((item) => item.isDefault)
                          ?? remaining[0];
                        setSelectedAddressId(next?.id ?? "");
                        setEditingAddressId(null);
                        if (next) applyAddress(next);
                      })(); }}>Excluir</button></div>
                  </div></div></div>
                </article>)}
                {savedAddresses.length < 3 && editingAddressId !== "new" ? <button className="secondary-button checkout-address-add" type="button" onClick={() => { setAddressLabel("Casa"); setEditingAddressId("new"); }}><Plus aria-hidden="true" /> Adicionar endereço</button> : null}
              </div>
            ) : null}
            {savedAddresses.length && !editingAddressId ? (() => {
              const address = savedAddresses.find((item) => item.id === selectedAddressId);
              return address ? <>{Object.entries({ postalCode: address.postalCode, street: address.street, number: address.number,
                complement: address.complement, district: address.district, city: address.city, state: address.state })
                .map(([name, value]) => <input type="hidden" name={name} value={value} key={name} />)}</> : null;
            })() : null}
            {(!savedAddresses.length || editingAddressId) ? <><div className="checkout-address-labels"><span>Salvar este endereço como</span>
              <label><input type="radio" name="addressLabel" value="Casa" checked={addressLabel === "Casa"} onChange={() => setAddressLabel("Casa")} /> Casa</label>
              <label><input type="radio" name="addressLabel" value="Trabalho" checked={addressLabel === "Trabalho"} onChange={() => setAddressLabel("Trabalho")} /> Trabalho</label></div>
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
                     resetShippingQuote();
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
            <button className="secondary-button" type="button" disabled={shippingState === "loading"}
              onClick={() => void calculateShipping()}>
              {shippingState === "loading" ? <LoaderCircle className="spin" width={20} height={20} /> : null}
              {shippingState === "loading" ? "Calculando…" : shippingState === "error" ? "Tentar novamente" : "Calcular frete"}
            </button>
            {shippingQuotes.length ? <fieldset className="checkout-shipping-options">
              <legend className="sr-only">Opções de entrega</legend>
              {shippingQuotes.map((quote) => <label key={quote.id}>
                <input type="radio" name="shippingQuote" value={quote.id}
                  checked={selectedShippingQuoteId === quote.id}
                  onChange={() => { setSelectedShippingQuoteId(quote.id); setShippingMessage("Opção de entrega selecionada."); }} />
                <span><strong>{quote.service}</strong><small>{quote.carrier}{quote.estimatedDays ? ` · até ${quote.estimatedDays} dias úteis` : ""}</small></span>
                <strong>{formatBRL(quote.amountInCents)}</strong>
              </label>)}
            </fieldset> : null}
            <p className="checkout-simple-status" role={shippingState === "error" ? "alert" : "status"}>
              {shippingMessage || "Informe o CEP e calcule as opções disponíveis."}
            </p>
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
            <CheckoutTotals subtotal={subtotal} shippingInCents={selectedShippingQuote?.amountInCents ?? null}
              discountInCents={coupon.discountInCents} couponName={coupon.name} />
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
