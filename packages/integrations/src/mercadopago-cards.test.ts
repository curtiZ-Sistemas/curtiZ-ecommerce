import { afterEach, describe, expect, it, vi } from "vitest";
import { MercadoPagoCustomerCardsProvider } from "./mercadopago-cards";
afterEach(() => vi.unstubAllGlobals());
const provider = () => new MercadoPagoCustomerCardsProvider("TEST-secret");
const card = { id: "card-1", customer_id: "customer-1", expiration_month: 12, expiration_year: 2099,
  last_four_digits: "4242", payment_method: { id: "visa", payment_type_id: "credit_card" },
  first_six_digits: "not-for-client", security_code: { length: 3 }, cardholder: { name: "not-for-client" } };
describe("Mercado Pago Customers/Cards adapter", () => {
  it("recusa credenciais de produção enquanto TEST permanece obrigatório", () => {
    expect(() => new MercadoPagoCustomerCardsProvider("APP_USR-secret")).toThrow();
  });
  it("filtra vencidos, inválidos e Customer divergente; retorna somente metadata permitida", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([card,
      { ...card, id: "expired", expiration_year: 2020 }, { ...card, id: "other", customer_id: "customer-other" },
      { ...card, id: "invalid", last_four_digits: "12345" }]))));
    expect(await provider().listCards("customer-1")).toEqual([{ id: "card-1", brand: "visa", lastFour: "4242", expirationMonth: 12, expirationYear: 2099 }]);
  });
  it("não associa Customer apenas pelo email sem o marcador definido pelo servidor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [
      { id: "other", email: "test_payer_1@testuser.com", description: "other-user" }
    ] }))));
    expect(await provider().findOwnedCustomer("test_payer_1@testuser.com", "curtiz:test:owned")).toBeNull();
  });
  it("salva um token novo no provider sem retornar dados brutos e usa chave da operação", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(card)));
    vi.stubGlobal("fetch", fetchMock);
    expect(await provider().saveCard("customer-1", "fresh-save-token", "operation-key")).toBe("card-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/v1/customers/customer-1/cards");
    expect(init.cache).toBe("no-store");
    if (typeof init.body !== "string") throw new Error("missing_body");
    expect(JSON.parse(init.body)).toEqual({ token: "fresh-save-token" });
    expect(new Headers(init.headers).get("x-idempotency-key")).toBe("operation-key");
  });
  it("obtém apenas referência de um token ativo, preservando validação de CVV pelo provider", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ card_id: "card-1", status: "active", security_code_length: 3 }))));
    expect(await provider().getTokenCardId("fresh-cvv-token")).toBe("card-1");
  });
  it("recusa token consumido", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ card_id: "card-1", status: "used" }))));
    await expect(provider().getTokenCardId("used-token")).rejects.toThrow();
  });
  it("exclui somente o path do Customer fornecido pelo backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await provider().deleteCard("customer-1", "card-1");
    expect(fetchMock).toHaveBeenCalledWith("https://api.mercadopago.com/v1/customers/customer-1/cards/card-1", expect.objectContaining({ method: "DELETE" }));
  });
});
