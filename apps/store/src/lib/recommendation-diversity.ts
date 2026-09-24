import type { Product } from "@curtiz/domain";
import { appendEligibleRecommendations } from "./recommendation-fallback";

export type RecommendationDiversity = "balanced" | "product_detail";

type DiversityOptions = {
  excludeProductIds?: readonly string[];
  currentProduct?: Product;
  limit: number;
  mode?: RecommendationDiversity;
};

const normalize = (value: string) => value.toLocaleLowerCase("pt-BR")
  .normalize("NFD").replace(/[\u0300-\u036f]/gu, "").replace(/[^a-z0-9]+/gu, " ").trim();

const colors = new Set([
  "amarelo", "amarela", "azul", "bege", "branco", "branca", "bordo", "caramelo",
  "champagne", "cinza", "cobre", "colorida", "coloridas", "colorido", "coloridos", "coral",
  "dourado", "dourada", "fucsia", "grafite", "laranja", "lilas", "marrom", "multicolorido",
  "nude", "off", "pink", "prata", "prateado", "prateada", "preto", "preta", "rose", "rosa",
  "roxo", "roxa", "verde", "vermelho", "vermelha"
]);

const genericWords = new Set([
  "a", "as", "ao", "aos", "com", "da", "das", "de", "do", "dos", "e", "em", "feminino",
  "femininos", "feminina", "femininas", "masculino", "masculinos", "para", "por", "sem",
  "um", "uma", "uns", "umas", "chinelo", "chinelos", "sandalia", "sandalias", "confortavel",
  "confortaveis", "conforto", "leve", "leves", "dia", "praia", "moderno", "moderna", "modernos",
  "modernas", "oferta", "premium", "produto", "produtos", "modelo", "modelos", "unidade", "unidades",
  "par", "pares", "peca", "pecas", "unitario", "unitaria", "avulso", "avulsa", "completo",
  "completa", "ideal", "versatil", "versateis"
]);

const typeTerms: Array<[string, RegExp]> = [
  ["chinelo", /\bchinelos?\b/iu],
  ["sandalia", /\bsandalias?\b/iu],
  ["slide", /\bslides?\b/iu],
  ["rasteira", /\brasteiras?\b/iu],
  ["tamanco", /\btamancos?\b/iu],
  ["mule", /\bmules?\b/iu],
  ["sapatilha", /\bsapatilhas?\b/iu]
];

type FamilyFeatures = {
  model: string;
  type: string;
  kit: boolean;
  kitCount: number | null;
  finishes: Set<string>;
  semanticWords: Set<string>;
};

function productText(product: Product): string {
  return normalize([product.name, product.variantTitle ?? ""].join(" "));
}

function productType(product: Product, text: string): string {
  const match = typeTerms.find(([, pattern]) => pattern.test(text));
  if (match) return match[0];
  const category = normalize(product.categorySlug ?? product.category);
  if (/\bsandalias?\b/u.test(category)) return "sandalia";
  if (/\bchinelos?\b/u.test(category)) return "chinelo";
  return "";
}

function isKit(product: Product, text = productText(product)): boolean {
  if (/\b(unitario|unitaria|avulso|avulsa)\b/iu.test(text)) return false;
  const source = `${text} ${normalize(product.description)}`;
  return /\b(kit|combo|conjunto|duo|dupla|trio|quarteto)\b/iu.test(source)
    || /\b\d{1,2}\s*pares?\b/iu.test(source);
}

function kitQuantity(product: Product, text: string): number | null {
  const source = `${text} ${normalize(product.description)}`;
  const kitFirst = source.match(/\b(?:kit|combo|conjunto)\s*(?:com\s*)?(\d{1,2})\b/iu);
  const countFirst = source.match(/\b(\d{1,2})\s*(?:pares?|unidades?|pecas)\b/iu);
  const count = Number(kitFirst?.[1] ?? countFirst?.[1]);
  return Number.isInteger(count) && count > 0 && count <= 24 ? count : null;
}

function productFinishes(text: string): Set<string> {
  const finishes = new Set<string>();
  if (/\b(strass|pedraria|brilho|brilhante|glitter|glitterizado)\b/iu.test(text)) finishes.add("brilho");
  if (/\b(liso|lisa|lisos|lisas)\b/iu.test(text)) finishes.add("liso");
  if (/\b(estampa|estampado|estampada|estampados|estampadas|tropical|floral)\b/iu.test(text))
    finishes.add("estampado");
  if (/\b(metalizado|metalizada|metalizados|metalizadas)\b/iu.test(text)) finishes.add("metalizado");
  return finishes;
}

function familyFeatures(product: Product): FamilyFeatures {
  const text = productText(product);
  const productName = normalize([product.name, product.variantTitle ?? ""].join(" "));
  const type = productType(product, text);
  const kit = isKit(product, text);
  const colorsToRemove = new Set((product.colors ?? []).map(normalize));
  if (product.variantColor) colorsToRemove.add(normalize(product.variantColor));
  const sizesToRemove = new Set((product.sizes ?? []).map(normalize));
  if (product.variantSize) sizesToRemove.add(normalize(product.variantSize));
  const finishes = productFinishes(text);
  const semanticWords = new Set(productName.split(" ").filter((word) =>
    word.length > 1
    && !colors.has(word)
    && !colorsToRemove.has(word)
    && !sizesToRemove.has(word)
    && !genericWords.has(word)
    && !/^\d{1,3}$/u.test(word)
    && !typeTerms.some(([, pattern]) => pattern.test(word))
    && ![...finishes].some((finish) => finish === word || (finish === "brilho" &&
      ["strass", "pedraria", "brilhante", "glitter", "glitterizado"].includes(word)))
  ));
  return {
    model: normalize(product.modelSlug ?? ""),
    type,
    kit,
    kitCount: kit ? kitQuantity(product, text) : null,
    finishes,
    semanticWords
  };
}

function overlapRatio(first: ReadonlySet<string>, second: ReadonlySet<string>): number {
  const overlap = [...first].filter((word) => second.has(word)).length;
  const union = first.size + second.size - overlap;
  return union ? overlap / union : 0;
}

/** Matches the same model and close commercial presentations across color and copy changes. */
function sameFamily(first: Product, second: Product): boolean {
  const a = familyFeatures(first);
  const b = familyFeatures(second);
  if (a.model && b.model && a.model === b.model) return true;
  if (a.type && b.type && a.type !== b.type) return false;
  if (a.kit !== b.kit) return false;
  if (a.finishes.size && b.finishes.size && ![...a.finishes].some((finish) => b.finishes.has(finish))) return false;

  // Kits with the same footwear type and finish are alternate presentations of one experience,
  // even when quantity or marketing copy changes (for example, strass versus pedraria).
  if (a.kit && b.kit && a.type && a.type === b.type
    && [...a.finishes].some((finish) => b.finishes.has(finish))) return true;

  const semanticSimilarity = overlapRatio(a.semanticWords, b.semanticWords);
  if (semanticSimilarity >= 0.6) return true;
  return !a.semanticWords.size && !b.semanticWords.size
    && a.type === b.type && a.kit === b.kit && a.kitCount === b.kitCount
    && a.finishes.size === b.finishes.size
    && !(a.model && b.model && a.model !== b.model)
    && [...a.finishes].every((finish) => b.finishes.has(finish));
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

function themes(product: Product): Set<string> {
  const category = normalize(product.categorySlug ?? product.category);
  const text = `${category} ${productText(product)}`;
  const result = new Set<string>();
  if (/\b(praia|piscina|beach|pool)\b/iu.test(text)) result.add("praia_piscina");
  if (/\b(strass|pedraria|brilho|brilhante|glitter|glitterizado)\b/iu.test(text)) result.add("brilho");
  if (/\b(estampa|estampado|estampada|estampados|estampadas|tropical|floral|animal print)\b/iu.test(text))
    result.add("estampados");
  if (/\b(dia a dia|casual|cotidiano)\b/iu.test(text)) result.add("dia_a_dia");
  if (/\b(kit|combo|conjunto|duo|dupla|trio|quarteto)\b/iu.test(text)) result.add("kits");
  return result;
}

function colorSet(product: Product): Set<string> {
  const selectedColor = product.variantColor && normalize(product.variantColor);
  const values = selectedColor ? [selectedColor] : product.colors ?? [];
  return new Set(values.map(normalize).filter(Boolean));
}

function similarityPenalty(product: Product, selected: readonly Product[]): number {
  const features = familyFeatures(product);
  const productThemes = themes(product);
  const productColors = colorSet(product);
  let penalty = 0;
  for (const existing of selected) {
    const existingFeatures = familyFeatures(existing);
    const sharedThemes = [...productThemes].filter((theme) => themes(existing).has(theme)).length;
    if (sharedThemes) penalty += sharedThemes * 1.25;
    if (features.kit && existingFeatures.kit) {
      penalty += features.kitCount === existingFeatures.kitCount ? 1.5 : 0.75;
    }
    const finishSimilarity = overlapRatio(features.finishes, existingFeatures.finishes);
    if (finishSimilarity) penalty += finishSimilarity * 1.75;
    const titleSimilarity = overlapRatio(features.semanticWords, existingFeatures.semanticWords);
    if (titleSimilarity >= 0.25) penalty += titleSimilarity * 2;
    const colorSimilarity = overlapRatio(productColors, colorSet(existing));
    if (colorSimilarity) penalty += colorSimilarity * 1.5;
  }
  return penalty;
}

/** Keeps ranking order as relevance, then selects distinct commercial families and images. */
export function diversifyRecommendations(
  candidates: readonly Product[],
  { excludeProductIds = [], currentProduct, limit, mode = "balanced" }: DiversityOptions
): Product[] {
  const target = Math.max(0, Math.min(24, limit));
  if (!target) return [];
  const excludedIds = new Set(excludeProductIds);
  if (currentProduct) excludedIds.add(currentProduct.id);
  const excludedIdentities = new Set(currentProduct?.recommendationIdentity
    ? [currentProduct.recommendationIdentity] : []);
  const currentImage = mode === "product_detail" && currentProduct ? imageIdentity(currentProduct) : "";
  const eligible = appendEligibleRecommendations([], candidates.filter((product) =>
    (!product.recommendationIdentity || !excludedIdentities.has(product.recommendationIdentity))
    && !(mode === "product_detail" && currentProduct && sameFamily(product, currentProduct))
    && !(currentImage && imageIdentity(product) === currentImage)),
  excludedIds, candidates.length);
  if (mode !== "product_detail") return eligible.slice(0, target);

  const imageCounts = new Map<string, number>();
  for (const product of eligible) {
    const image = imageIdentity(product);
    if (image) imageCounts.set(image, (imageCounts.get(image) ?? 0) + 1);
  }

  const remaining = [...eligible];
  const selected: Product[] = [];
  while (selected.length < target && remaining.length) {
    const available = remaining.filter((candidate) => {
      const image = imageIdentity(candidate);
      return !selected.some((item) => sameFamily(candidate, item)
        || (image && imageIdentity(item) === image));
    });
    if (!available.length) break;
    const chosen = available.reduce((best, candidate) => {
      const candidateImageCount = imageCounts.get(imageIdentity(candidate)) ?? 0;
      const bestImageCount = imageCounts.get(imageIdentity(best)) ?? 0;
      const candidateImagePenalty = candidateImageCount > 1 ? Math.min(8, candidateImageCount - 1) * 2 : 0;
      const bestImagePenalty = bestImageCount > 1 ? Math.min(8, bestImageCount - 1) * 2 : 0;
      const candidateScore = eligible.indexOf(candidate) + similarityPenalty(candidate, selected)
        + candidateImagePenalty;
      const bestScore = eligible.indexOf(best) + similarityPenalty(best, selected) + bestImagePenalty;
      return candidateScore < bestScore ? candidate : best;
    });
    selected.push(chosen);
    remaining.splice(remaining.indexOf(chosen), 1);
  }
  return selected;
}
