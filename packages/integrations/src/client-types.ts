/** Minimal card display data; contains no provider implementation or credentials. */
export type MercadoPagoSavedCard = {
  id: string; brand: string; lastFour: string; expirationMonth: number; expirationYear: number;
};
