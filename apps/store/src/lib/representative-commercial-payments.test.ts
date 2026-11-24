import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { encryptPII } from "@curtiz/security/pii";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beginCommercialKitPix, kitPaymentView } from "./representative-commercial-payments";

const orderId = "10000000-0000-4000-8000-000000000001";
const actor = { id: "20000000-0000-4000-8000-000000000002", email: "buyer@example.invalid" };
const cpf = "52998224725";
const cnpj = "11222333000181";
const summary = { orderId, state: "reserved", amountInCents: 12100, shippingInCents: 0, buyerName: "Synthetic buyer",
  expiresAt: "2099-01-01T00:00:00Z" };
const payment = { id: "123", externalReference: `KITMG-${orderId}`, collectorId: "456", paymentMethodId: "pix",
  currency: "BRL", amountInCents: 12100, status: "pending", dateApproved: null, refunds: [], pixCopyPaste: "00020126", expiresAt: "2099-01-01T00:00:00Z" };

function database(options: { buyerDocument: string | null; ciphertext: string | null }) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    if (name === "read_representative_kit_payment") return { data: { ...summary, customerCanPay: true }, error: null };
    if (name === "read_representative_kit_payer_cpf") return { data: options.ciphertext, error: null };
    if (name === "claim_representative_kit_pix") {
      return args.p_payer_cpf_ready !== true && options.buyerDocument === null
        ? { data: null, error: { code: "23514" } }
        : { data: { ...summary, buyerDocument: options.buyerDocument }, error: null };
    }
    if (name === "settle_representative_kit_payment") return { data: { ...summary, state: "payment_pending" }, error: null };
    return { data: null, error: { code: "XX000" } };
  });
  return { db: { rpc } as unknown as SupabaseClient, calls };
}

function provider() {
  return {
    getRepresentativeKitCollectorId: vi.fn(async () => "456"),
    createRepresentativeKitPix: vi.fn(async () => payment)
  };
}

describe("beginCommercialKitPix payer document", () => {
  beforeEach(() => {
    process.env.PII_ENCRYPTION_KEY = "test-key-test-key-test-key-test-key-0123";
  });

  it("uses the approved CNPJ when there is one and does not need the CPF", async () => {
    const { db, calls } = database({ buyerDocument: cnpj, ciphertext: encryptPII(cpf) });
    const mercado = provider();
    await beginCommercialKitPix(db, mercado as never, "456", actor, orderId);
    expect(mercado.createRepresentativeKitPix).toHaveBeenCalledWith(expect.objectContaining({ buyerDocument: cnpj }));
    expect(calls.find(([name]) => name === "claim_representative_kit_pix")?.[1]).toMatchObject({ p_payer_cpf_ready: true });
  });

  it("falls back to the representative CPF decrypted on the server", async () => {
    const { db } = database({ buyerDocument: null, ciphertext: encryptPII(cpf) });
    const mercado = provider();
    await beginCommercialKitPix(db, mercado as never, "456", actor, orderId);
    expect(mercado.createRepresentativeKitPix).toHaveBeenCalledWith(expect.objectContaining({ buyerDocument: cpf }));
  });

  it("claims nothing and never reaches the provider when neither a CNPJ nor a valid CPF exists", async () => {
    for (const ciphertext of [null, encryptPII("11111111111"), "not-a-ciphertext"]) {
      const { db, calls } = database({ buyerDocument: null, ciphertext });
      const mercado = provider();
      await expect(beginCommercialKitPix(db, mercado as never, "456", actor, orderId)).rejects.toMatchObject({ status: 409 });
      expect(calls.find(([name]) => name === "claim_representative_kit_pix")?.[1]).toMatchObject({ p_payer_cpf_ready: false });
      expect(mercado.createRepresentativeKitPix).not.toHaveBeenCalled();
    }
  });

  it("does not put any document in the console", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    const { db } = database({ buyerDocument: null, ciphertext: encryptPII(cpf) });
    await beginCommercialKitPix(db, provider() as never, "456", actor, orderId);
    expect(spies.every((spy) => !JSON.stringify(spy.mock.calls).includes(cpf))).toBe(true);
    spies.forEach((spy) => spy.mockRestore());
  });
});

describe("kitPaymentView Pix QR Code", () => {
  const context = { ...summary, state: "payment_pending", customerCanPay: true };
  const view = (pixQrCodeBase64?: string) => kitPaymentView(context, { ...payment, ...(pixQrCodeBase64 === undefined ? {} : { pixQrCodeBase64 }) } as never);

  it("includes a valid base64 QR Code next to the copy and paste code", () => {
    expect(view("iVBORw0KGgo=").pix).toEqual({ copyPaste: "00020126", expiresAt: payment.expiresAt, qrCodeBase64: "iVBORw0KGgo=" });
  });

  it("drops a QR Code that is missing, malformed or too large but keeps the copy and paste code", () => {
    for (const qr of [undefined, "", "not base64!", "<svg/>", "A".repeat(20001)]) {
      expect(view(qr).pix).toEqual({ copyPaste: "00020126", expiresAt: payment.expiresAt });
    }
    expect(view("A".repeat(20000)).pix).toHaveProperty("qrCodeBase64");
  });
});
