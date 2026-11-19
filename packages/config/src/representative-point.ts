import { z } from "zod";

const pointOrderId = z.string().regex(/^ORD[A-Za-z0-9]{12,62}$/u);
const amount = z.number().int().positive().max(999_999_999_999);

export const representativePointIntent = z.object({
  pointOrderId: pointOrderId.nullable(),
  pointKey: z.string().uuid(),
  method: z.enum(["pix", "debit_card", "credit_card"]),
  terminal: z.string().regex(/^[A-Za-z0-9_]{4,80}$/u),
  amountInCents: amount,
  confirmed: z.boolean()
});

export const representativePointRefund = representativePointIntent.extend({
  pointOrderId,
  confirmed: z.literal(false),
  refundId: z.string().uuid(),
  refundCents: amount,
  receipt: z.string().regex(/^PAY[A-Za-z0-9]{12,62}$/u),
  maySend: z.boolean(),
  previousRefundIds: z.array(z.string().regex(/^REF[A-Za-z0-9]{12,62}$/u)).max(100)
});
