// The published delivery policy allows up to five business days for preparation.
// Provider settings may already add time. Adding our preparation allowance is
// conservative and avoids promising an earlier delivery than the policy allows.
export const MAX_PREPARATION_BUSINESS_DAYS = 5;

export function totalDeliveryBusinessDays(transportBusinessDays: number): number {
  return transportBusinessDays + MAX_PREPARATION_BUSINESS_DAYS;
}
