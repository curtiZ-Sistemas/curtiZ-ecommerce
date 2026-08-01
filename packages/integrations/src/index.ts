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

export type ShippingQuoteInput = {
  postalCode: string;
  subtotalInCents: number;
  packages: Array<{ weightGrams: number; heightCm: number; widthCm: number; lengthCm: number }>;
};

export type ShippingQuote = {
  provider: string;
  service: string;
  amountInCents: number;
  estimatedDays: number;
  expiresAt: string;
};

export interface ShippingProvider {
  readonly name: string;
  health(): Promise<IntegrationState>;
  quote(input: ShippingQuoteInput): Promise<ShippingQuote[]>;
  createLabel(shipmentId: string): Promise<{ trackingCode: string; labelPath: string }>;
  cancelLabel(trackingCode: string): Promise<void>;
  track(trackingCode: string): Promise<Array<{ status: string; occurredAt: string }>>;
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
