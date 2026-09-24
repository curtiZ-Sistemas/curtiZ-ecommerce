import type { Product } from "@curtiz/domain";
import { appendEligibleRecommendations } from "./recommendation-fallback";

export type RecommendationDiversity = "balanced" | "product_detail";

type DiversityOptions = {
  excludeProductIds?: readonly string[];
  currentProduct?: Product;
  limit: number;
  mode?: RecommendationDiversity;
  relaxFamilies?: boolean;
};

const normalize = (value: string) => value.toLocaleLowerCase("pt-BR")
  .normalize("NFD").replace(/[\u0300-\u036f]/gu, "").replace(/[^a-z0-9]+/gu, " ").trim();

const colors = new Set([
  "amarelo", "amarela", "azul", "bege", "branco", "branca", "bordo", "caramelo",
  "cinza", "cobre", "coral", "dourado", "dourada", "estampado", "estampada", "fucsia",
  "grafite", "laranja", "lilas", "marrom", "nude", "off", "pink", "prata", "prateado",
  "prateada", "preto", "preta", "rose", "rosa", "roxo", "roxa", "verde", "vermelho",
  "vermelha"
]);

function normalizedModel(product: Product): string {
  return normalize(product.modelSlug ?? "");
}

function baseName(product: Product): string {
  const variantColors = new Set((product.colors ?? []).map(normalize));
  if (product.variantColor) variantColors.add(normalize(product.variantColor));
  const sizes = new Set((product.sizes ?? []).map(normalize));
  if (product.variantSize) sizes.add(normalize(product.variantSize));
  return normalize(product.name).split(" ").filter((word) =>
    !colors.has(word) && !variantColors.has(word) && !sizes.has(word) && !/^\d{1,3}$/u.test(word)
  ).join(" ").trim();
}

function isKit(product: Product): boolean {
  return /\b(kit|combo|conjunto|duo|pares)\b/iu.test(`${product.name} ${product.description}`);
}

function sameFamily(first: Product, second: Product): boolean {
  const firstModel = normalizedModel(first);
  const secondModel = normalizedModel(second);
  if (firstModel && secondModel) return firstModel === secondModel;
  const firstCategory = normalize(first.categorySlug ?? first.category);
  const secondCategory = normalize(second.categorySlug ?? second.category);
  if (firstCategory && secondCategory && firstCategory !== secondCategory) return false;
  if (isKit(first) !== isKit(second)) return false;
  const firstName = baseName(first);
  const secondName = baseName(second);
  if (firstName.length >= 6 && firstName === secondName) return true;
  const firstWords = new Set(firstName.split(" ").filter((word) => word.length > 1));
  const secondWords = new Set(secondName.split(" ").filter((word) => word.length > 1));
  if (!firstWords.size || !secondWords.size) return false;
  const overlap = [...firstWords].filter((word) => secondWords.has(word)).length;
  return overlap / (firstWords.size + secondWords.size - overlap) >= 0.84;
}

function imageIdentity(product: Product): string {
  const source = product.imagePath || product.image;
  try {
    const pathname = new URL(source, "https://curtiz.invalid").pathname.toLocaleLowerCase("pt-BR");
    const storagePath = pathname.match(/\/catalog-public\/(.+)$/u)?.[1];
    return (storagePath ?? pathname).replace(/^\/+|\/+$/gu, "");
  } catch {
    return source.toLocaleLowerCase("pt-BR").split(/[?#]/u)[0]?.replace(/^\/+|\/+$/gu, "") ?? "";
  }
}

function theme(product: Product): string {
  return normalize(product.categorySlug ?? product.category);
}

function colorSet(product: Product): Set<string> {
  const selectedColor = product.variantColor && normalize(product.variantColor);
  const values = selectedColor ? [selectedColor] : product.colors ?? [];
  return new Set(values.map(normalize).filter(Boolean));
}

function similarityPenalty(product: Product, selected: readonly Product[]): number {
  let penalty = 0;
  for (const existing of selected) {
    if (theme(product) && theme(product) === theme(existing)) penalty += 1.5;
    if (isKit(product) === isKit(existing)) penalty += 0.35;
    const firstWords = new Set(baseName(product).split(" ").filter(Boolean));
    const secondWords = new Set(baseName(existing).split(" ").filter(Boolean));
    const overlap = [...firstWords].filter((word) => secondWords.has(word)).length;
    const titleSimilarity = firstWords.size + secondWords.size - overlap
      ? overlap / (firstWords.size + secondWords.size - overlap) : 0;
    if (titleSimilarity >= 0.4) penalty += titleSimilarity * 2;
    const firstColors = colorSet(product);
    const secondColors = colorSet(existing);
    const colorOverlap = [...firstColors].filter((color) => secondColors.has(color)).length;
    const colorSimilarity = firstColors.size + secondColors.size - colorOverlap
      ? colorOverlap / (firstColors.size + secondColors.size - colorOverlap) : 0;
    if (colorSimilarity > 0) penalty += colorSimilarity * 2;
  }
  return penalty;
}

/** Keeps source order as the relevance ranking and progressively relaxes only diversity limits. */
export function diversifyRecommendations(
  candidates: readonly Product[],
  { excludeProductIds = [], currentProduct, limit, mode = "balanced", relaxFamilies = false }: DiversityOptions
): Product[] {
  const target = Math.max(0, Math.min(24, limit));
  if (!target) return [];
  const excludedIds = new Set(excludeProductIds);
  if (currentProduct) excludedIds.add(currentProduct.id);
  const excludedIdentities = new Set(currentProduct?.recommendationIdentity
    ? [currentProduct.recommendationIdentity] : []);
  const eligible = appendEligibleRecommendations([], candidates.filter((product) =>
    !product.recommendationIdentity || !excludedIdentities.has(product.recommendationIdentity)),
  excludedIds, candidates.length);
  if (mode !== "product_detail") return eligible.slice(0, target);

  const imageCounts = new Map<string, number>();
  for (const product of eligible) {
    const image = imageIdentity(product);
    imageCounts.set(image, (imageCounts.get(image) ?? 0) + 1);
  }

  const select = (maxPerFamily: number, maxPerTheme: number, allowRepeatedImage: boolean) => {
    const selected: Product[] = [];
    const remaining = [...eligible];
    while (selected.length < target && remaining.length) {
      const familyCounts = (candidate: Product) => selected.filter((item) => sameFamily(candidate, item)).length;
      const themeCounts = (candidate: Product) => selected.filter((item) => theme(candidate) === theme(item)).length;
      const available = remaining.filter((candidate) =>
        familyCounts(candidate) < maxPerFamily
        && themeCounts(candidate) < maxPerTheme
        && (allowRepeatedImage || !selected.some((item) => imageIdentity(candidate) === imageIdentity(item)))
      );
      if (!available.length) break;
      const chosen = available.reduce((best, candidate) => {
        const candidateImageCount = imageCounts.get(imageIdentity(candidate)) ?? 0;
        const bestImageCount = imageCounts.get(imageIdentity(best)) ?? 0;
        const candidateImagePenalty = candidateImageCount > 1 ? candidateImageCount * 2 : 0;
        const bestImagePenalty = bestImageCount > 1 ? bestImageCount * 2 : 0;
        const candidateScore = eligible.indexOf(candidate) + similarityPenalty(candidate, selected)
          + candidateImagePenalty;
        const bestScore = eligible.indexOf(best) + similarityPenalty(best, selected) + bestImagePenalty;
        return candidateScore < bestScore ? candidate : best;
      });
      selected.push(chosen);
      remaining.splice(remaining.indexOf(chosen), 1);
    }
    return selected;
  };

  const passes = [
    select(1, 2, false),
    select(1, Number.POSITIVE_INFINITY, false),
    select(2, Number.POSITIVE_INFINITY, false)
  ];
  if (relaxFamilies) passes.push(
    select(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, false),
    select(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, true)
  );
  return passes.find((products) => products.length >= target) ?? passes.at(-1) ?? [];
}
