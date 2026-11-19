import { describe, expect, it, vi } from "vitest";
import { reconcileRepresentativePoint, representativePointIntent } from "./mercadopago-point";

vi.mock("server-only", () => ({}));

const credentials = { accessToken: "synthetic", collector: "123" };
const key = "10000000-0000-4000-8000-000000000001";
const id = "ORD10000000000000000000000001";
const paymentId = "PAY10000000000000000000000001";
const intent = representativePointIntent.parse({
  pointOrderId: id, pointKey: key, method: "pix", terminal: "POINT_TEST", amountInCents: 6300, confirmed: false
});

function response({ methodId = "pix", paid = "63.00", status = "processed", user = "123", transaction = "processed" } = {}) {
  return Response.json({
    id, user_id: user, type: "point", country_code: "BRA", external_reference: `KITMG-POS-${key}`, status,
    config: { point: { terminal_id: intent.terminal }, payment_method: { default_type: "qr" } },
    transactions: { payments: [{ id: paymentId, amount: "63.00", paid_amount: paid, status: transaction,
      payment_method: { type: "bank_transfer", id: methodId } }] }
  });
}

describe("recebimento de kits no Point", () => {
  it("concilia o método, o terminal, o valor e o recebedor", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response());
    await expect(reconcileRepresentativePoint(transport, credentials, intent, "refresh"))
      .resolves.toEqual({ id, status: "processed", receipt: paymentId });
  });

  it.each([{ methodId: "account_money" }, { paid: "63.01" }, { user: "124" }, { transaction: "action_required" }])(
    "recusa confirmar um recebimento divergente %j",
    async (different) => {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(response(different));
      await expect(reconcileRepresentativePoint(transport, credentials, intent, "refresh")).rejects.toThrow();
    }
  );

  it("só confirma o cancelamento após observar o estado final", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(response({ status: "at_terminal", transaction: "at_terminal" }));
    await expect(reconcileRepresentativePoint(transport, credentials, intent, "cancel"))
      .resolves.toEqual({ id, status: "at_terminal", receipt: null });
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
