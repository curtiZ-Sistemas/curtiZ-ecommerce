// Card payment methods accepted by the Mercado Pago integration, shared by the store checkout and
// the representative kit checkout so both keep exactly the same list.
export const mercadoPagoDebitMethodIds: ReadonlySet<string> = new Set(["debcabal", "debmaster", "debvisa"]);
export const mercadoPagoCreditMethodIds: ReadonlySet<string> = new Set(["amex", "diners", "elo", "hipercard", "master", "visa"]);
export const mercadoPagoCardMethodIds: ReadonlySet<string> = new Set([
  ...mercadoPagoCreditMethodIds, ...mercadoPagoDebitMethodIds
]);
