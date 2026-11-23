import { MercadoPagoProviderError } from "@curtiz/integrations";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { encryptPII } from "@curtiz/security/pii";
import {
  beginCommercialKitCard, commercialKitCardSession, kitCardRefusalMessage, reconcileCommercialKitPayment,
  recoverCommercialKitPayment, type KitCardInput
} from "./representative-commercial-payments";

const orderId = "10000000-0000-4000-8000-000000000001";
const attemptId = "30000000-0000-4000-8000-000000000003";
const actor = { id: "20000000-0000-4000-8000-000000000002", email: "buyer@example.invalid" };
const cnpj = "11222333000181";
const cpf = "52998224725";
const summary = { orderId, state: "reserved", amountInCents: 12100, shippingInCents: 0, buyerName: "Synthetic buyer" };
const card: KitCardInput = { kind: "credit", paymentMethodId: "visa", token: "token-fixture-123", installments: 3 };
const base = { id: "123", externalReference: `KITMG-${orderId}`, collectorId: "456", paymentMethodId: "visa", paymentTypeId: "credit_card",
  currency: "BRL", amountInCents: 12100, status: "approved", statusDetail: "accredited", dateApproved: "2026-11-24T12:00:00Z",
  refunds: [], pixCopyPaste: "", expiresAt: null };

type Options = { started?: boolean; buyerDocument?: string | null; ciphertext?: string | null; claimError?: { code: string; message?: string } };
function database(options: Options = {}) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  let state = "reserved";
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    if (name === "read_representative_kit_payment") {
      return { data: { ...summary, state, startedAt: options.started ? "2026-11-24T11:00:00Z" : "", customerCanPay: true }, error: null };
    }
    if (name === "read_representative_kit_payer_cpf") return { data: options.ciphertext ?? null, error: null };
    if (name === "claim_representative_kit_card") {
      if (options.claimError) return { data: null, error: options.claimError };
      return { data: { ...summary, buyerDocument: options.buyerDocument === undefined ? cnpj : options.buyerDocument, attemptId }, error: null };
    }
    if (name === "settle_representative_kit_payment") {
      const status = args.p_status;
      state = status === "approved" ? "paid" : status === "rejected" ? "reserved" : "payment_pending";
      return { data: { ...summary, state }, error: null };
    }
    if (name === "release_representative_kit_card_claim") return { data: true, error: null };
    return { data: null, error: { code: "XX000" } };
  });
  return { db: { rpc } as unknown as SupabaseClient, calls };
}

function provider(created: object = base, failure?: unknown) {
  return {
    getRepresentativeKitCollectorId: vi.fn(async () => "456"),
    createPayment: vi.fn(async () => { if (failure) throw failure instanceof Error ? failure : new Error("failure"); return created; }),
    getPayment: vi.fn(async () => base),
    findRepresentativeKitPayment: vi.fn(async () => null)
  };
}

describe("beginCommercialKitCard", () => {
  beforeEach(() => { process.env.PII_ENCRYPTION_KEY = "test-key-test-key-test-key-test-key-0123"; });

  it("charges the approved CNPJ with the token and installments and settles an approved card as paid", async () => {
    const { db, calls } = database();
    const mercado = provider();
    const result = await beginCommercialKitCard(db, mercado as never, "456", actor, orderId, card);
    expect(mercado.createPayment).toHaveBeenCalledWith(expect.objectContaining({
      aggregate: "representative_kit_orders", orderId, orderCode: `KITMG-${orderId}`, amountInCents: 12100, token: card.token,
      installments: 3, paymentMethodId: "visa", customerDocument: cnpj, documentType: "CNPJ", entityType: "association",
      idempotencyKey: attemptId
    }));
    expect(calls.find(([name]) => name === "settle_representative_kit_payment")?.[1]).toMatchObject({
      p_order: orderId, p_payment_id: "123", p_status: "approved", p_amount: 12100 });
    expect(result).toMatchObject({ order: { state: "paid" }, card: { status: "approved" } });
  });

  it("falls back to the representative CPF when the approval has no CNPJ", async () => {
    const { db, calls } = database({ buyerDocument: null, ciphertext: encryptPII(cpf) });
    const mercado = provider();
    await beginCommercialKitCard(db, mercado as never, "456", actor, orderId, card);
    expect(calls.find(([name]) => name === "claim_representative_kit_card")?.[1]).toMatchObject({ p_payer_cpf_ready: true });
    expect(mercado.createPayment).toHaveBeenCalledWith(expect.objectContaining({
      customerDocument: cpf, documentType: "CPF", entityType: "individual" }));
  });

  it("reports a refused card with a clear message and keeps the order open for another try", async () => {
    const { db } = database();
    const result = await beginCommercialKitCard(db, provider({ ...base, status: "rejected", statusDetail: "cc_rejected_insufficient_amount",
      dateApproved: null }) as never, "456", actor, orderId, card);
    expect(result.card).toMatchObject({ status: "rejected" });
    expect((result.card as { message?: string }).message).toMatch(/Saldo/u);
    expect(result.order.state).toBe("reserved");
  });

  it("leaves a card in analysis waiting for payment", async () => {
    const { db } = database();
    const result = await beginCommercialKitCard(db, provider({ ...base, status: "in_process", statusDetail: "pending_review_manual",
      dateApproved: null }) as never, "456", actor, orderId, card);
    expect(result).toMatchObject({ order: { state: "payment_pending" }, card: { status: "in_process" } });
  });

  it("never creates a second payment while an attempt is already started", async () => {
    const { db, calls } = database({ started: true });
    const mercado = provider();
    await beginCommercialKitCard(db, mercado as never, "456", actor, orderId, card);
    expect(mercado.createPayment).not.toHaveBeenCalled();
    expect(calls.some(([name]) => name === "claim_representative_kit_card")).toBe(false);
  });

  it("does not create a payment when the claim lost the race", async () => {
    const { db } = database();
    const originalRpc = (db as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> }).rpc;
    (db as unknown as { rpc: unknown }).rpc = async (name: string, args: Record<string, unknown>) =>
      name === "claim_representative_kit_card" ? { data: null, error: null } : originalRpc(name, args);
    const mercado = provider();
    await beginCommercialKitCard(db, mercado as never, "456", actor, orderId, card);
    expect(mercado.createPayment).not.toHaveBeenCalled();
  });

  it("is blocked exactly like the Pix: a database refusal never reaches the provider", async () => {
    const { db } = database({ claimError: { code: "23514" } });
    const mercado = provider();
    await expect(beginCommercialKitCard(db, mercado as never, "456", actor, orderId, card)).rejects.toMatchObject({ status: 409 });
    expect(mercado.createPayment).not.toHaveBeenCalled();
  });

  it("states that a valid CPF or CNPJ is missing without exposing any document", async () => {
    const { db } = database({ claimError: { code: "23514", message: "kit_payer_document_required" }, ciphertext: encryptPII("11111111111") });
    await expect(beginCommercialKitCard(db, provider() as never, "456", actor, orderId, card))
      .rejects.toMatchObject({ status: 409, reason: "payer_document_required" });
  });

  it("returns the claim when the provider refuses the request itself, and keeps it for an uncertain failure", async () => {
    const refused = database();
    const result = await beginCommercialKitCard(refused.db, provider(base, new MercadoPagoProviderError("payment_rejected", 400)) as never,
      "456", actor, orderId, card);
    expect(result.card.status).toBe("declined");
    expect(refused.calls.find(([name]) => name === "release_representative_kit_card_claim")?.[1])
      .toEqual({ p_actor: actor.id, p_order: orderId, p_attempt: attemptId });
    const uncertain = database();
    await expect(beginCommercialKitCard(uncertain.db, provider(base, new MercadoPagoProviderError("provider_unavailable", 502)) as never,
      "456", actor, orderId, card)).rejects.toBeInstanceOf(MercadoPagoProviderError);
    expect(uncertain.calls.some(([name]) => name === "release_representative_kit_card_claim")).toBe(false);
  });

  it("rejects inconsistent card input before touching the database", async () => {
    const { db, calls } = database();
    for (const bad of [
      { ...card, paymentMethodId: "debvisa" }, { ...card, kind: "debit" as const }, { ...card, kind: "debit" as const, paymentMethodId: "debvisa", installments: 2 },
      { ...card, installments: 49 }, { ...card, paymentMethodId: "pix" }, { ...card, token: "short" }
    ]) await expect(beginCommercialKitCard(db, provider() as never, "456", actor, orderId, bad)).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
    await beginCommercialKitCard(db, provider({ ...base, paymentMethodId: "debvisa", paymentTypeId: "debit_card" }) as never, "456", actor, orderId,
      { kind: "debit", paymentMethodId: "debvisa", token: "token-fixture-123", installments: 1 });
  });

  it("does not put the token or any document in the console", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map(level => vi.spyOn(console, level).mockImplementation(() => undefined));
    const { db } = database({ buyerDocument: null, ciphertext: encryptPII(cpf) });
    await beginCommercialKitCard(db, provider() as never, "456", actor, orderId, card);
    expect(spies.every(spy => !JSON.stringify(spy.mock.calls).includes(cpf) && !JSON.stringify(spy.mock.calls).includes(card.token))).toBe(true);
    spies.forEach(spy => spy.mockRestore());
  });
});

describe("kit card reconciliation", () => {
  it("accepts credit and debit cards of the right type and refuses anything else", async () => {
    const { db } = database();
    await expect(reconcileCommercialKitPayment(db, base as never, "456", orderId)).resolves.toBeTruthy();
    await expect(reconcileCommercialKitPayment(db, { ...base, paymentMethodId: "debmaster", paymentTypeId: "debit_card" } as never, "456", orderId)).resolves.toBeTruthy();
    for (const change of [{ paymentTypeId: "debit_card" }, { paymentMethodId: "bolbradesco" }, { paymentMethodId: "debvisa" }, { collectorId: "999" }]) {
      await expect(reconcileCommercialKitPayment(db, { ...base, ...change } as never, "456", orderId)).rejects.toBeTruthy();
    }
  });

  it("reconciles every provider state through the same settlement", async () => {
    for (const status of ["approved", "rejected", "in_process", "pending", "cancelled", "refunded", "charged_back"]) {
      const { db, calls } = database();
      await reconcileCommercialKitPayment(db, { ...base, status } as never, "456");
      expect(calls.find(([name]) => name === "settle_representative_kit_payment")?.[1]).toMatchObject({ p_status: status });
    }
  });

  it("releases a card claim that left no payment once its window is over, but never a Pix claim", async () => {
    const { db, calls } = database();
    (db as unknown as { rpc: unknown }).rpc = vi.fn(async (name: string) => ({ data: name === "expire_representative_kit_card_claim" ? true : null, error: null }));
    const mercado = provider();
    await recoverCommercialKitPayment(db, mercado as never, "456", { orderId, startedAt: "x", expiresAt: "2020-01-01T00:00:00Z", paymentMethod: "card" });
    expect((db as unknown as { rpc: { mock: { calls: unknown[][] } } }).rpc.mock.calls.map(call => call[0])).toEqual(["expire_representative_kit_card_claim"]);
    (db as unknown as { rpc: { mockClear: () => void } }).rpc.mockClear();
    await recoverCommercialKitPayment(db, mercado as never, "456", { orderId, startedAt: "x", expiresAt: "2020-01-01T00:00:00Z" });
    expect((db as unknown as { rpc: { mock: { calls: unknown[][] } } }).rpc.mock.calls.map(call => call[0])).toEqual(["defer_representative_kit_payment_check"]);
    expect(calls).toHaveLength(0);
  });
});

describe("kit card session and messages", () => {
  const environment = { MERCADO_PAGO_ENVIRONMENT: "production", MERCADO_PAGO_PRODUCTION_READY: "true",
    MERCADO_PAGO_ACCESS_TOKEN: "APP_USR-token", NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY: "APP_USR-public" };

  it("exposes only the public key, amount and e-mail for an order that can still be paid", async () => {
    const { db } = database();
    await expect(commercialKitCardSession(db, actor, orderId, environment as never)).resolves.toEqual({
      orderId, amountInCents: 12100, publicKey: "APP_USR-public", email: actor.email });
    await expect(commercialKitCardSession(database({ started: true }).db, actor, orderId, environment as never)).rejects.toMatchObject({ status: 409 });
    await expect(commercialKitCardSession(db, actor, orderId, { ...environment, MERCADO_PAGO_ENVIRONMENT: "test" })).rejects.toMatchObject({ status: 503 });
  });

  it("maps provider detail codes to fixed messages", () => {
    expect(kitCardRefusalMessage("cc_rejected_bad_filled_security_code")).toContain("Revise");
    expect(kitCardRefusalMessage("cc_rejected_other_reason")).toContain("recusado");
  });
});
