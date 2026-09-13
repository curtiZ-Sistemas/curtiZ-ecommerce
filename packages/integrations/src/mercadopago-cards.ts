import { isMercadoPagoTestCredential, MercadoPagoProviderError } from "./index";

export type MercadoPagoSavedCard = {
  id: string; brand: string; lastFour: string; expirationMonth: number; expirationYear: number;
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const providerReference = (value: unknown): string => {
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return /^[a-zA-Z0-9_+-]{1,100}$/u.test(text) ? text : "";
};

// No raw provider object leaves this adapter. Card tokens live only in request memory.
export class MercadoPagoCustomerCardsProvider {
  constructor(private readonly accessToken: string) {
    if (!isMercadoPagoTestCredential(accessToken)) throw new MercadoPagoProviderError("invalid_test_credential", 503);
  }
  private async request(path: string, method = "GET", body?: unknown, key?: string): Promise<unknown> {
    const headers = new Headers({ authorization: `Bearer ${this.accessToken}`, "content-type": "application/json" });
    if (key) headers.set("x-idempotency-key", key);
    const response = await fetch(`https://api.mercadopago.com${path}`, {
      method, headers, cache: "no-store", signal: AbortSignal.timeout(15_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (!response.ok) throw new MercadoPagoProviderError("provider_unavailable", response.status);
    if (method === "DELETE") return null;
    const result: unknown = await response.json().catch(() => null);
    if (result === null) throw new MercadoPagoProviderError("invalid_provider_response");
    return result;
  }
  async findOwnedCustomer(email: string, marker: string): Promise<string | null> {
    const result = record(await this.request(`/v1/customers/search?email=${encodeURIComponent(email)}`));
    const matches = (Array.isArray(result.results) ? result.results : []).map(record)
      .filter(customer => customer.description === marker && customer.email === email);
    if (matches.length > 1) throw new MercadoPagoProviderError("invalid_provider_response");
    const match = matches[0];
    return match ? providerReference(match.id) || null : null;
  }
  async createCustomer(email: string, marker: string, key: string): Promise<string> {
    const result = record(await this.request("/v1/customers", "POST", { email, description: marker }, key));
    const id = providerReference(result.id);
    if (!id || result.email !== email || result.description !== marker) throw new MercadoPagoProviderError("invalid_provider_response");
    return id;
  }
  async listCards(customerId: string, now = new Date(), includeExpired = false): Promise<MercadoPagoSavedCard[]> {
    const result = await this.request(`/v1/customers/${encodeURIComponent(customerId)}/cards`);
    if (!Array.isArray(result)) throw new MercadoPagoProviderError("invalid_provider_response");
    return result.flatMap(value => {
      const card = record(value), method = record(card.payment_method);
      const id = providerReference(card.id), month = Number(card.expiration_month), year = Number(card.expiration_year);
      const lastFour = typeof card.last_four_digits === "string" ? card.last_four_digits : "";
      if (!id || !/^\d{4}$/u.test(lastFour) || !Number.isInteger(month) || month < 1 || month > 12 ||
        !Number.isInteger(year) || year < 1970 || year > 9999 ||
        (!includeExpired && (year < now.getUTCFullYear() || (year === now.getUTCFullYear() && month < now.getUTCMonth() + 1))) ||
        !["credit_card", "debit_card"].includes(String(method.payment_type_id)) ||
        (card.customer_id !== undefined && providerReference(card.customer_id) !== customerId)) return [];
      const brand = typeof method.id === "string" && /^[a-z0-9_-]{2,50}$/u.test(method.id) ? method.id : "";
      return brand ? [{ id, brand, lastFour, expirationMonth: month, expirationYear: year }] : [];
    });
  }
  async getTokenCardId(token: string): Promise<string> {
    const result = record(await this.request(`/v1/card_tokens/${encodeURIComponent(token)}`));
    const id = providerReference(result.card_id);
    if (!id || result.status !== "active") throw new MercadoPagoProviderError("invalid_provider_response", 400);
    return id;
  }
  async saveCard(customerId: string, freshToken: string, key: string): Promise<string> {
    const result = record(await this.request(`/v1/customers/${encodeURIComponent(customerId)}/cards`, "POST", { token: freshToken }, key));
    const id = providerReference(result.id);
    if (!id || providerReference(result.customer_id) !== customerId) throw new MercadoPagoProviderError("invalid_provider_response");
    return id;
  }
  async deleteCard(customerId: string, cardId: string): Promise<void> {
    await this.request(`/v1/customers/${encodeURIComponent(customerId)}/cards/${encodeURIComponent(cardId)}`, "DELETE");
  }
}
