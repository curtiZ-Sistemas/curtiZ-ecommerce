import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { deleteMyMercadoPagoCard, getOrCreateMercadoPagoCustomer, listMyMercadoPagoCards, saveMyMercadoPagoCard, validateSavedCardPayer } from "./mercadopago-saved-cards";
vi.mock("server-only", () => ({}));
const user = { id: "11111111-1111-4111-8111-111111111111", email: "test_payer_1@testuser.com", email_confirmed_at: "2026-09-13" } as User;
const other = { ...user, id: "22222222-2222-4222-8222-222222222222" };
const card = { id: "card-1", customer_id: "customer-1", expiration_month: 12, expiration_year: 2099,
  last_four_digits: "4242", payment_method: { id: "visa", payment_type_id: "credit_card" } };
function setup(ready = true) {
  let state = ready ? "ready" : "new", providerId: string | null = ready ? "customer-1" : null;
  const operations = new Map<string, { state: string; cardId?: string }>();
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_mercadopago_customer") {
      const claimed = state === "new"; if (claimed) state = "creating";
      return { data: { id: "local-1", providerCustomerId: providerId, creationKey: "creation-key", claimed }, error: null };
    }
    if (name === "finish_mercadopago_customer") { providerId = args.p_provider_id as string | null; state = providerId ? "ready" : "new"; }
    if (name === "claim_mercadopago_card_save") {
      const key = String(args.p_key), operation = operations.get(key);
      if (operation) return { data: { claimed: false, ...operation }, error: null };
      if ([...operations.values()].some(op => op.state === "processing")) return { data: null, error: { message: "card_save_in_progress" } };
      operations.set(key, { state: "processing" });
      return { data: { claimed: true }, error: null };
    }
    if (name === "finish_mercadopago_card_save") operations.set(String(args.p_key), { state: args.p_failed ? "failed" : "succeeded", cardId: args.p_card_id as string });
    return { data: null, error: null };
  });
  const db = { rpc, from(table: string) {
    const filters: Record<string, unknown> = {};
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      maybeSingle: async () => ({ data: (filters.user_id === other.id || filters.customer_id === other.id) ? null
        : table === "orders" ? { id: "order-1" } : { id: "local-1", provider_customer_id: providerId, state }, error: null }) };
    return query;
  } } as unknown as Parameters<typeof listMyMercadoPagoCards>[0];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/search?")) return new Response(JSON.stringify({ results: [] }));
    if (url.endsWith("/v1/customers")) return new Response(JSON.stringify({ id: "customer-1", email: user.email, description: `curtiz:test:${user.id}` }));
    if (url.includes("/card_tokens/")) return new Response(JSON.stringify({ card_id: "card-1", status: "active" }));
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(JSON.stringify(init?.method === "POST" ? card : [card]));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { db, rpc, fetchMock, operations, customerState: () => state };
}
beforeEach(() => {
  vi.stubEnv("MERCADO_PAGO_SAVED_CARDS_ENABLED", "true"); vi.stubEnv("MERCADO_PAGO_ACCESS_TOKEN", "TEST-token");
  vi.stubEnv("NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY", "TEST-public");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("cartões salvos: associação e operações no servidor", () => {
  it("default false não consulta o provider nem exige migration", async () => {
    const { db, fetchMock, rpc } = setup(); vi.stubEnv("MERCADO_PAGO_SAVED_CARDS_ENABLED", "");
    expect(await listMyMercadoPagoCards(db, user)).toEqual({ enabled: false, customerId: "", cards: [] });
    expect(fetchMock).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it("Sandbox atual com email comum permanece indisponível", async () => {
    const { db, fetchMock } = setup();
    expect((await listMyMercadoPagoCards(db, { ...user, email: "cliente@example.com" })).enabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("usuário B não obtém referência nem cartões de A", async () => {
    const { db, fetchMock } = setup();
    expect((await listMyMercadoPagoCards(db, other)).cards).toEqual([]); expect(fetchMock).not.toHaveBeenCalled();
    await expect(validateSavedCardPayer(db, other, "customer-1", "token")).rejects.toMatchObject({ code: "SAVED_CARD_NOT_OWNED" });
  });
  it("duas criações simultâneas emitem um único POST Customer", async () => {
    const { db, fetchMock } = setup(false);
    const outcomes = await Promise.allSettled([getOrCreateMercadoPagoCustomer(db, user), getOrCreateMercadoPagoCustomer(db, user)]);
    expect(outcomes.some(outcome => outcome.status === "fulfilled")).toBe(true);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/v1/customers"))).toHaveLength(1);
    expect(await getOrCreateMercadoPagoCustomer(db, user)).toEqual({ localId: "local-1", providerId: "customer-1" });
  });
  it("perda de resposta de Customer bloqueia recriação automática", async () => {
    const { db, fetchMock, customerState } = setup(false);
    fetchMock.mockImplementation(async (url) => { if (url.endsWith("/v1/customers")) throw new Error("lost_response"); return new Response('{"results":[]}'); });
    await expect(getOrCreateMercadoPagoCustomer(db, user)).rejects.toThrow();
    await expect(getOrCreateMercadoPagoCustomer(db, user)).rejects.toMatchObject({ code: "CUSTOMER_CREATION_IN_PROGRESS" });
    expect(customerState()).toBe("creating"); expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/v1/customers"))).toHaveLength(1);
  });
  it("opt-in usa Customer/Cards e repetir a operação não duplica associação nem persiste token", async () => {
    const { db, fetchMock, operations, rpc } = setup(false);
    const input = { orderId: "order-1", key: "save-key", token: "fresh-save-only-token", consent: true as const };
    await saveMyMercadoPagoCard(db, user, input); await saveMyMercadoPagoCard(db, user, input);
    expect(fetchMock.mock.calls.filter(([url, init]) => url.endsWith("/cards") && init?.method === "POST")).toHaveLength(1);
    expect(JSON.stringify([...operations.values()])).not.toContain(input.token);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(input.token);
  });
  it("operação de salvamento incerta não repete o POST Cards", async () => {
    const { db, fetchMock } = setup();
    fetchMock.mockImplementation(async () => { throw new Error("lost_response"); });
    const input = { orderId: "order-1", key: "save-key", token: "fresh-token", consent: true as const };
    await expect(saveMyMercadoPagoCard(db, user, input)).rejects.toThrow();
    await expect(saveMyMercadoPagoCard(db, user, input)).rejects.toMatchObject({ code: "CARD_SAVE_UNCONFIRMED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("exclusão verifica Customer e cartão próprios e registra auditoria sanitizada", async () => {
    const { db, fetchMock, rpc } = setup();
    await expect(deleteMyMercadoPagoCard(db, other, "card-1", "request-id")).rejects.toMatchObject({ code: "CARD_NOT_FOUND" });
    await expect(deleteMyMercadoPagoCard(db, user, "card-of-b", "request-id")).rejects.toMatchObject({ code: "CARD_NOT_FOUND" });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
    await deleteMyMercadoPagoCard(db, user, "card-1", "request-id");
    expect(rpc).toHaveBeenCalledWith("audit_mercadopago_card_delete", expect.objectContaining({ p_user_id: user.id, p_card_id: "card-1" }));
  });
});
