export type PromotionRule =
  | { type: "percentage"; basisPoints: number; maximumInCents?: number }
  | { type: "fixed"; amountInCents: number }
  | { type: "free_shipping" }
  | { type: "quantity"; minimumQuantity: number; basisPoints: number };

export const evaluatePromotion = (
  rule: PromotionRule,
  context: { subtotalInCents: number; quantity: number; shippingInCents: number }
): number => {
  switch (rule.type) {
    case "percentage": {
      const raw = Math.floor((context.subtotalInCents * rule.basisPoints) / 10_000);
      return Math.min(raw, rule.maximumInCents ?? raw);
    }
    case "fixed":
      return Math.min(rule.amountInCents, context.subtotalInCents);
    case "free_shipping":
      return context.shippingInCents;
    case "quantity":
      return context.quantity >= rule.minimumQuantity
        ? Math.floor((context.subtotalInCents * rule.basisPoints) / 10_000)
        : 0;
  }
};
