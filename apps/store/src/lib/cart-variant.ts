import type { CartLine } from "@curtiz/domain";

export type CartVariantSelection = {
  id: string;
  color: string;
  size: string;
  priceInCents: number;
  stock: number;
  image?: string;
};

export function changeCartVariantState(
  lines: CartLine[],
  selectedVariantIds: ReadonlySet<string>,
  oldVariantId: string,
  nextVariant: CartVariantSelection
) {
  const source = lines.find((line) => line.variantId === oldVariantId);
  if (!source || source.unavailableAt || nextVariant.stock < 1) {
    return { lines, selectedVariantIds: new Set(selectedVariantIds) };
  }

  const destination = lines.find((line) => line.variantId === nextVariant.id);
  if (destination && destination.productId !== source.productId) {
    return { lines, selectedVariantIds: new Set(selectedVariantIds) };
  }

  const maxQuantity = Math.min(nextVariant.stock, 10);
  const quantity = Math.min(
    source.quantity + (destination && destination !== source ? destination.quantity : 0),
    maxQuantity
  );
  const replacement: CartLine = {
    ...(destination ?? source),
    variantId: nextVariant.id,
    color: nextVariant.color,
    size: nextVariant.size,
    quantity,
    maxQuantity,
    unitPriceInCents: nextVariant.priceInCents,
    image: nextVariant.image ?? (destination ?? source).image
  };
  delete replacement.unavailableAt;

  const nextLines = destination && destination !== source
    ? lines
        .filter((line) => line.variantId !== oldVariantId)
        .map((line) => (line.variantId === nextVariant.id ? replacement : line))
    : lines.map((line) => (line.variantId === oldVariantId ? replacement : line));
  const nextSelected = new Set(selectedVariantIds);
  const remainsSelected = nextSelected.has(oldVariantId) || nextSelected.has(nextVariant.id);
  nextSelected.delete(oldVariantId);
  if (remainsSelected) nextSelected.add(nextVariant.id);

  return { lines: nextLines, selectedVariantIds: nextSelected };
}
