export const representativeKitState = "MG";
export const representativeKitScopeMessage = "A compra de kits para revenda atende apenas Minas Gerais.";

export function isRepresentativeKitPostalCode(value: string) {
  return /^3\d{4}-?\d{3}$/u.test(value);
}
