export const formatBRL = (valueInCents: number): string =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(valueInCents / 100);

export const calculateSubtotal = (
  lines: ReadonlyArray<{ quantity: number; unitPriceInCents: number }>
): number =>
  lines.reduce((total, line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 0) {
      throw new Error("Quantidade inválida.");
    }
    if (!Number.isInteger(line.unitPriceInCents) || line.unitPriceInCents < 0) {
      throw new Error("Preço inválido.");
    }
    return total + line.quantity * line.unitPriceInCents;
  }, 0);

export const percentageDiscount = (subtotalInCents: number, basisPoints: number): number => {
  if (basisPoints < 0 || basisPoints > 10_000) throw new Error("Percentual inválido.");
  return Math.floor((subtotalInCents * basisPoints) / 10_000);
};
