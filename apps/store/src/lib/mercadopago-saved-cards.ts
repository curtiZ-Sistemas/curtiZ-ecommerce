import "server-only";
import type { User } from "@supabase/supabase-js";
import { isMercadoPagoTestCredential, MercadoPagoCustomerCardsProvider, MercadoPagoProviderError } from "@curtiz/integrations";
import type { createServiceSupabaseClient } from "./supabase/server";
import { isUnknownRecord, readQueryResult, readString } from "./unknown-data";

type CardsDb = NonNullable<ReturnType<typeof createServiceSupabaseClient>>;
export class SavedCardsError extends Error {
  constructor(readonly code: string, readonly status = 503) { super(code); }
}
export const savedCardsEnabled = () => process.env.MERCADO_PAGO_SAVED_CARDS_ENABLED === "true"
  && isMercadoPagoTestCredential(process.env.MERCADO_PAGO_ACCESS_TOKEN)
  && isMercadoPagoTestCredential(process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY);
const cardsProvider = () => {
  if (!savedCardsEnabled()) throw new SavedCardsError("SAVED_CARDS_UNAVAILABLE");
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!token) throw new SavedCardsError("SAVED_CARDS_UNAVAILABLE");
  return new MercadoPagoCustomerCardsProvider(token.trim());
};
const eligibleUser = (user: User) => Boolean(user.email_confirmed_at && user.email
  && /^test_payer_\d{1,10}@testuser\.com$/u.test(user.email));
const customerReference = async (db: CardsDb, userId: string) => {
  const result = readQueryResult(await db.from("payment_provider_customers")
    .select("id,provider_customer_id,state").eq("user_id", userId).eq("provider", "mercadopago").eq("payment_mode", "test").maybeSingle());
  if (result.error) throw new SavedCardsError("CUSTOMER_LOOKUP_UNAVAILABLE");
  return isUnknownRecord(result.data) ? result.data : null;
};
export async function listMyMercadoPagoCards(db: CardsDb, user: User) {
  if (!savedCardsEnabled() || !eligibleUser(user)) return { enabled: false, customerId: "", cards: [] };
  const customer = await customerReference(db, user.id);
  const customerId = customer ? readString(customer, "provider_customer_id") : "";
  return { enabled: true, customerId, cards: customerId ? await cardsProvider().listCards(customerId) : [] };
}
export async function getOrCreateMercadoPagoCustomer(db: CardsDb, user: User) {
  if (!eligibleUser(user)) throw new SavedCardsError("SAVED_CARDS_USER_UNSUPPORTED", 409);
  const email = user.email;
  if (!email) throw new SavedCardsError("SAVED_CARDS_USER_UNSUPPORTED", 409);
  const provider = cardsProvider();
  const claim = readQueryResult(await db.rpc("claim_mercadopago_customer", { p_user_id: user.id, p_mode: "test" }));
  if (claim.error || !isUnknownRecord(claim.data)) throw new SavedCardsError("CUSTOMER_CLAIM_UNAVAILABLE");
  const localId = readString(claim.data, "id"), key = readString(claim.data, "creationKey");
  let providerId = readString(claim.data, "providerCustomerId");
  if (!localId || !key) throw new SavedCardsError("CUSTOMER_CLAIM_UNAVAILABLE");
  if (providerId) return { localId, providerId };
  const marker = `curtiz:test:${user.id}`;
  providerId = await provider.findOwnedCustomer(email, marker) ?? "";
  if (!providerId) {
    // A lost response remains "creating": never issue a second create on lease expiry.
    if (claim.data.claimed !== true) throw new SavedCardsError("CUSTOMER_CREATION_IN_PROGRESS", 409);
    try { providerId = await provider.createCustomer(email, marker, key); }
    catch (error) {
      if (error instanceof MercadoPagoProviderError && [400, 422].includes(error.httpStatus)) {
        // Recover an already-created customer only when its server marker also matches.
        providerId = await provider.findOwnedCustomer(email, marker) ?? "";
        if (!providerId) await db.rpc("finish_mercadopago_customer", { p_id: localId, p_key: key, p_provider_id: null });
      }
      if (!providerId) throw error;
    }
  }
  const finish = readQueryResult(await db.rpc("finish_mercadopago_customer", { p_id: localId, p_key: key, p_provider_id: providerId }));
  if (finish.error) throw new SavedCardsError("CUSTOMER_LINK_UNAVAILABLE");
  return { localId, providerId };
}
export async function validateSavedCardCustomer(db: CardsDb, user: User, customerId: string) {
  if (!savedCardsEnabled() || !eligibleUser(user)) throw new SavedCardsError("SAVED_CARD_NOT_OWNED", 403);
  const reference = await customerReference(db, user.id);
  if (!customerId || !reference || readString(reference, "provider_customer_id") !== customerId) throw new SavedCardsError("SAVED_CARD_NOT_OWNED", 403);
  return customerId;
}
export async function validateSavedCardPayer(db: CardsDb, user: User, customerId: string, token: string) {
  await validateSavedCardCustomer(db, user, customerId);
  const cards = await cardsProvider().listCards(customerId);
  const cardId = await cardsProvider().getTokenCardId(token);
  if (!cards.some(card => card.id === cardId)) throw new SavedCardsError("SAVED_CARD_NOT_OWNED", 403);
  return customerId;
}
export async function saveMyMercadoPagoCard(db: CardsDb, user: User, input: { orderId: string; key: string; token: string; consent: true }) {
  // Eligibility is checked before making any provider create request.
  const order = readQueryResult(await db.from("orders").select("id").eq("id", input.orderId)
    .eq("customer_id", user.id).eq("payment_status", "approved").maybeSingle());
  if (order.error || !isUnknownRecord(order.data)) throw new SavedCardsError("APPROVED_ORDER_REQUIRED", 403);
  const customer = await getOrCreateMercadoPagoCustomer(db, user);
  const claim = readQueryResult(await db.rpc("claim_mercadopago_card_save", {
    p_user_id: user.id, p_customer_id: customer.localId, p_order_id: input.orderId, p_key: input.key
  }));
  if (claim.error || !isUnknownRecord(claim.data)) throw new SavedCardsError("CARD_SAVE_CONFLICT", 409);
  if (claim.data.claimed !== true) {
    if (claim.data.state === "succeeded") return;
    throw new SavedCardsError("CARD_SAVE_UNCONFIRMED", 409);
  }
  let cardId: string;
  try { cardId = await cardsProvider().saveCard(customer.providerId, input.token, input.key); }
  catch (error) {
    // Only an explicit refusal permits a new save attempt. No token is persisted for retry.
    if (error instanceof MercadoPagoProviderError && [400, 422].includes(error.httpStatus))
      await db.rpc("finish_mercadopago_card_save", { p_key: input.key, p_card_id: null, p_failed: true });
    throw error;
  }
  const finished = readQueryResult(await db.rpc("finish_mercadopago_card_save", { p_key: input.key, p_card_id: cardId, p_failed: false }));
  if (finished.error) throw new SavedCardsError("CARD_SAVE_UNCONFIRMED", 409);
}
export async function deleteMyMercadoPagoCard(db: CardsDb, user: User, cardId: string, requestId: string) {
  const customer = await customerReference(db, user.id);
  if (!customer || !readString(customer, "provider_customer_id")) throw new SavedCardsError("CARD_NOT_FOUND", 404);
  const provider = cardsProvider(), providerId = readString(customer, "provider_customer_id");
  // Listing this backend-owned Customer proves ownership; a free card_id never selects a Customer.
  const cards = await provider.listCards(providerId, new Date(), true);
  if (!cards.some(card => card.id === cardId)) throw new SavedCardsError("CARD_NOT_FOUND", 404);
  await provider.deleteCard(providerId, cardId);
  const audit = readQueryResult(await db.rpc("audit_mercadopago_card_delete", {
    p_user_id: user.id, p_customer_id: readString(customer, "id"), p_card_id: cardId, p_request_id: requestId
  }));
  if (audit.error) throw new SavedCardsError("CARD_DELETE_AUDIT_UNAVAILABLE");
}
