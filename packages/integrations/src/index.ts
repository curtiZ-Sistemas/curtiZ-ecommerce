import type { IntegrationState, RequestContext } from "@curtiz/domain";

export type CheckoutRequest = {
  orderId: string;
  amountInCents: number;
  currency: "BRL";
  idempotencyKey: string;
  customerEmail: string;
};

export type CheckoutSession = {
  provider: string;
  externalReference: string;
  redirectUrl: string;
  state: "pending";
};

export interface PaymentProvider {
  readonly name: string;
  health(): Promise<IntegrationState>;
  createCheckout(request: CheckoutRequest, context: RequestContext): Promise<CheckoutSession>;
  getPayment(providerPaymentId: string): Promise<{
    status: "pending" | "approved" | "rejected" | "cancelled" | "refunded";
    amountInCents: number;
    externalReference: string;
  }>;
  refund(providerPaymentId: string, amountInCents: number, idempotencyKey: string): Promise<void>;
  validateWebhook(headers: Headers, rawBody: string): Promise<boolean>;
}

export type MercadoPagoPaymentInput = {
  orderId: string;
  orderCode: string;
  amountInCents: number;
  currency: "BRL";
  idempotencyKey: string;
  customerEmail: string;
  customerName: string;
  customerDocument: string;
  entityType: "individual" | "association";
  paymentMethodId: string;
  token?: string;
  issuerId?: string;
  installments: number;
};

export type MercadoPagoPayment = {
  id: string;
  status: string;
  statusDetail: string;
  amountInCents: number;
  currency: string;
  externalReference: string;
  paymentMethodId: string;
  paymentTypeId: string;
  dateApproved: string | null;
};

export class MercadoPagoProviderError extends Error {
  constructor(
    readonly code: "invalid_test_credential" | "provider_unavailable" | "invalid_provider_response",
    readonly httpStatus = 502
  ) {
    super(code);
    this.name = "MercadoPagoProviderError";
  }
}

export const isMercadoPagoTestCredential = (value: string | undefined): value is string =>
  value?.trim().startsWith("TEST-") === true;

const mercadoPagoPayment = (value: unknown): MercadoPagoPayment => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MercadoPagoProviderError("invalid_provider_response");
  }
  const payment = value as Record<string, unknown>;
  const id = typeof payment.id === "number" || typeof payment.id === "string" ? String(payment.id) : "";
  const amount = Number(payment.transaction_amount);
  if (!id || !Number.isFinite(amount) || amount < 0) {
    throw new MercadoPagoProviderError("invalid_provider_response");
  }
  return {
    id,
    status: typeof payment.status === "string" ? payment.status : "pending",
    statusDetail: typeof payment.status_detail === "string" ? payment.status_detail : "",
    amountInCents: Math.round(amount * 100),
    currency: typeof payment.currency_id === "string" ? payment.currency_id : "",
    externalReference:
      typeof payment.external_reference === "string" ? payment.external_reference : "",
    paymentMethodId:
      typeof payment.payment_method_id === "string" ? payment.payment_method_id : "",
    paymentTypeId: typeof payment.payment_type_id === "string" ? payment.payment_type_id : "",
    dateApproved: typeof payment.date_approved === "string" ? payment.date_approved : null
  };
};

export class MercadoPagoTestPaymentProvider {
  readonly name = "mercadopago";

  constructor(private readonly accessToken: string) {
    if (!isMercadoPagoTestCredential(accessToken)) {
      throw new MercadoPagoProviderError("invalid_test_credential", 503);
    }
  }

  private async request(path: string, init: RequestInit, idempotencyKey?: string) {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.accessToken}`);
    headers.set("content-type", "application/json");
    if (idempotencyKey) headers.set("x-idempotency-key", idempotencyKey);
    const response = await fetch(`https://api.mercadopago.com${path}`, { ...init, headers });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new MercadoPagoProviderError("provider_unavailable", response.status);
    return mercadoPagoPayment(body);
  }

  async createPayment(input: MercadoPagoPaymentInput): Promise<MercadoPagoPayment> {
    return this.request(
      "/v1/payments",
      {
        method: "POST",
        body: JSON.stringify({
          transaction_amount: input.amountInCents / 100,
          token: input.token,
          description: `Pedido ${input.orderCode}`,
          installments: input.installments,
          payment_method_id: input.paymentMethodId,
          issuer_id: input.issuerId,
          payer: {
            email: input.customerEmail,
            first_name: input.customerName,
            entity_type: input.entityType,
            identification: { type: "CPF", number: input.customerDocument }
          },
          external_reference: input.orderCode,
          statement_descriptor: "CURTIZ",
          metadata: { order_id: input.orderId },
          binary_mode: false
        })
      },
      input.idempotencyKey
    );
  }

  async getPayment(providerPaymentId: string): Promise<MercadoPagoPayment> {
    return this.request(`/v1/payments/${encodeURIComponent(providerPaymentId)}`, { method: "GET" });
  }
}

export type ShippingQuoteInput = {
  postalCode: string;
  subtotalInCents: number;
  packages: Array<{ weightGrams: number; heightCm: number; widthCm: number; lengthCm: number }>;
};

export type ShippingQuote = {
  provider: string;
  service: string;
  amountInCents: number;
  estimatedDays: number | null;
  expiresAt: string | null;
};

export interface ShippingProvider {
  readonly name: string;
  health(): Promise<IntegrationState>;
  quote(input: ShippingQuoteInput): Promise<ShippingQuote[]>;
  createLabel(shipmentId: string): Promise<{ trackingCode: string; labelPath: string }>;
  cancelLabel(trackingCode: string): Promise<void>;
  track(trackingCode: string): Promise<Array<{ status: string; occurredAt: string }>>;
}

export const FIXED_SHIPPING_IN_CENTS = 1_690;

export class FixedShippingProvider implements ShippingProvider {
  readonly name = "fixed_shipping";

  async health(): Promise<IntegrationState> {
    return "online";
  }

  async quote(input: ShippingQuoteInput): Promise<ShippingQuote[]> {
    void input;
    return [{
      provider: this.name,
      service: "Entrega padrão",
      amountInCents: FIXED_SHIPPING_IN_CENTS,
      estimatedDays: null,
      expiresAt: null
    }];
  }

  async createLabel(): Promise<never> {
    throw new Error("fixed_shipping_does_not_create_labels");
  }

  async cancelLabel(): Promise<void> {}

  async track(): Promise<Array<{ status: string; occurredAt: string }>> {
    return [];
  }
}

export interface EmailProvider {
  readonly name: string;
  health(): Promise<IntegrationState>;
  send(message: {
    to: string;
    template:
      | "welcome"
      | "order_received"
      | "payment_approved"
      | "shipped"
      | "support_reply"
      | "password_changed";
    variables: Record<string, string>;
    idempotencyKey: string;
  }): Promise<{ messageId: string }>;
}

export interface MarketingProvider {
  readonly name: string;
  health(): Promise<IntegrationState>;
  enqueue(event: {
    type: "abandoned_cart" | "post_purchase" | "restock" | "price_drop";
    userId: string;
    consentVerified: boolean;
  }): Promise<void>;
}

export interface WhatsAppProvider {
  readonly name: string;
  health(): Promise<IntegrationState>;
  sendApprovedTemplate(input: {
    recipient: string;
    template: string;
    variables: string[];
    consentVerified: boolean;
  }): Promise<{ messageId: string }>;
}

export interface ERPProvider {
  readonly name: string;
  health(): Promise<IntegrationState>;
  syncOrder(orderId: string): Promise<{ externalId: string }>;
  issueInvoice(orderId: string): Promise<{ status: "issued" | "rejected"; reference: string }>;
}

export const isMockRuntimeAllowed = (
  environment: Readonly<Record<string, string | undefined>> = process.env
): boolean => {
  const appEnvironment = environment.APP_ENV?.trim().toLowerCase();
  if (appEnvironment === "production") return false;
  if (appEnvironment === "development" || appEnvironment === "staging") return true;
  return environment.NODE_ENV !== "production";
};

const developmentOnly = (): void => {
  if (!isMockRuntimeAllowed()) {
    throw new Error("Provider mock bloqueado em produção.");
  }
};

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  async health(): Promise<IntegrationState> {
    return "online";
  }
  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    developmentOnly();
    return {
      provider: this.name,
      externalReference: `mock-${request.orderId}`,
      redirectUrl: `/pedido/pendente?order=${encodeURIComponent(request.orderId)}`,
      state: "pending"
    };
  }
  async getPayment(providerPaymentId: string) {
    developmentOnly();
    return {
      status: "pending" as const,
      amountInCents: 0,
      externalReference: providerPaymentId
    };
  }
  async refund(): Promise<void> {
    developmentOnly();
  }
  async validateWebhook(): Promise<boolean> {
    developmentOnly();
    return true;
  }
}

export class MockShippingProvider implements ShippingProvider {
  readonly name = "mock";
  async health(): Promise<IntegrationState> {
    return isMockRuntimeAllowed() ? "online" : "not_configured";
  }
  async quote(input: ShippingQuoteInput): Promise<ShippingQuote[]> {
    developmentOnly();
    const free = input.subtotalInCents >= 14_900;
    return [
      {
        provider: this.name,
        service: "Entrega padrão",
        amountInCents: free ? 0 : 1_990,
        estimatedDays: 6,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
      }
    ];
  }
  async createLabel(shipmentId: string) {
    developmentOnly();
    return { trackingCode: `DEMO${shipmentId.slice(0, 8)}`, labelPath: "" };
  }
  async cancelLabel(): Promise<void> {
    developmentOnly();
  }
  async track(): Promise<Array<{ status: string; occurredAt: string }>> {
    developmentOnly();
    return [];
  }
}

export const unconfiguredState = async (): Promise<IntegrationState> => "not_configured";
