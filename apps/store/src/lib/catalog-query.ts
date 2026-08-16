import type { Product } from "@curtiz/domain";
import { demoProducts } from "./catalog";

export const catalogSorts = [
  "relevant",
  "newest",
  "best_sellers",
  "rating",
  "price_asc",
  "price_desc",
  "discount",
  "name_asc",
  "name_desc"
] as const;

export type CatalogSort = (typeof catalogSorts)[number];

export type CatalogFilters = {
  query?: string;
  category?: string;
  collection?: string;
  colors: string[];
  sizes: string[];
  priceMin?: number;
  priceMax?: number;
  promotion: boolean;
  inStock: boolean;
  newest: boolean;
  minRating?: number;
  sort: CatalogSort;
  page: number;
  pageSize: number;
};

export type FacetOption = { value: string; label: string; count: number; hex?: string };

export type CatalogFacets = {
  categories: FacetOption[];
  collections: FacetOption[];
  colors: FacetOption[];
  sizes: FacetOption[];
  price: { min: number; max: number };
  promotionCount: number;
  inStockCount: number;
  newestCount: number;
};

export type CatalogResult = {
  products: Product[];
  facets: CatalogFacets;
  total: number;
  page: number;
  pageSize: number;
  source: "supabase" | "demo";
};

const unique = <T>(items: T[]) => [...new Set(items)];

const optionCounts = (values: string[]): FacetOption[] =>
  Object.entries(
    values.reduce<Record<string, number>>((counts, value) => {
      counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    }, {})
  )
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((first, second) => first.label.localeCompare(second.label, "pt-BR"));

export const parseCatalogFilters = (params: URLSearchParams, fixedCategory?: string): CatalogFilters => {
  const readList = (name: string) =>
    unique(
      (params.get(name) ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    ).slice(0, 20);
  const readMoney = (name: string) => {
    const raw = params.get(name);
    if (!raw?.trim()) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : undefined;
  };
  const requestedSort = params.get("ordem");
  const sort = catalogSorts.includes(requestedSort as CatalogSort)
    ? (requestedSort as CatalogSort)
    : "relevant";

  return {
    query: params.get("q")?.trim().slice(0, 100) || undefined,
    category:
      fixedCategory ?? (params.get("categoria")?.trim().slice(0, 80) || undefined),
    collection: params.get("colecao")?.trim().slice(0, 80) || undefined,
    colors: readList("cores"),
    sizes: readList("tamanhos"),
    priceMin: readMoney("preco_min"),
    priceMax: readMoney("preco_max"),
    promotion: params.get("promocao") === "1",
    inStock: params.get("estoque") === "1",
    newest: params.get("novidades") === "1",
    minRating: [3, 4, 4.5].includes(Number(params.get("avaliacao")))
      ? Number(params.get("avaliacao"))
      : undefined,
    sort,
    page: Math.max(1, Math.min(500, Number(params.get("pagina")) || 1)),
    pageSize: 12
  };
};

export const queryDemoCatalog = (filters: CatalogFilters): CatalogResult => {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLocaleLowerCase("pt-BR")
      .trim();
  const editDistance = (left: string, right: string) => {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      const current = [leftIndex];
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        current[rightIndex] = Math.min(
          (current[rightIndex - 1] ?? 0) + 1,
          (previous[rightIndex] ?? 0) + 1,
          (previous[rightIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
        );
      }
      previous.splice(0, previous.length, ...current);
    }
    return previous[right.length] ?? right.length;
  };
  const normalizedQuery = filters.query ? normalize(filters.query) : undefined;
  const categoryFiltered = demoProducts.filter((product) => {
    if (filters.inStock && product.stock <= 0) return false;
    if (
      filters.category &&
      product.category.toLocaleLowerCase("pt-BR") !== filters.category.toLocaleLowerCase("pt-BR")
    ) {
      return false;
    }
    if (normalizedQuery) {
      const haystack = normalize(
        `${product.name} ${product.category} ${product.colors.join(" ")} ${product.description}`
      );
      const words = haystack.split(/\s+/u);
      const matches = haystack.includes(normalizedQuery) || normalizedQuery
        .split(/\s+/u)
        .every((term) => words.some((word) => word.includes(term) || (term.length >= 4 && editDistance(term, word) <= 2)));
      if (!matches) return false;
    }
    if (filters.collection) return false;
    return true;
  });

  const prices = categoryFiltered.map((product) => product.priceInCents);
  const facets: CatalogFacets = {
    categories: optionCounts(categoryFiltered.map((product) => product.category)),
    collections: [],
    colors: optionCounts(categoryFiltered.flatMap((product) => product.colors)),
    sizes: optionCounts(categoryFiltered.flatMap((product) => product.sizes)),
    price: {
      min: prices.length ? Math.min(...prices) : 0,
      max: prices.length ? Math.max(...prices) : 0
    },
    promotionCount: categoryFiltered.filter((product) => product.compareAtPriceInCents).length,
    inStockCount: categoryFiltered.filter((product) => product.stock > 0).length,
    newestCount: categoryFiltered.filter((product) => product.featured).length
  };

  const filtered = categoryFiltered.filter((product) => {
    if (filters.colors.length && !filters.colors.some((color) => product.colors.includes(color))) {
      return false;
    }
    if (filters.sizes.length && !filters.sizes.some((size) => product.sizes.includes(size))) {
      return false;
    }
    if (filters.priceMin !== undefined && product.priceInCents < filters.priceMin) return false;
    if (filters.priceMax !== undefined && product.priceInCents > filters.priceMax) return false;
    if (filters.promotion && !product.compareAtPriceInCents) return false;
    if (filters.newest && !product.featured) return false;
    if (filters.minRating !== undefined && product.rating < filters.minRating) return false;
    return true;
  });

  const products = [...filtered].sort((first, second) => {
    let comparison = 0;
    if (filters.sort === "price_asc") comparison = first.priceInCents - second.priceInCents;
    if (filters.sort === "price_desc") comparison = second.priceInCents - first.priceInCents;
    if (filters.sort === "newest")
      comparison = Number(Boolean(second.featured)) - Number(Boolean(first.featured));
    if (filters.sort === "best_sellers") comparison = second.reviews - first.reviews;
    if (filters.sort === "rating") comparison = second.rating - first.rating;
    if (filters.sort === "discount") {
      const discount = (product: Product) =>
        product.compareAtPriceInCents
          ? 1 - product.priceInCents / product.compareAtPriceInCents
          : 0;
      comparison = discount(second) - discount(first);
    }
    if (filters.sort === "name_asc") comparison = first.name.localeCompare(second.name, "pt-BR");
    if (filters.sort === "name_desc") comparison = second.name.localeCompare(first.name, "pt-BR");
    if (filters.sort === "relevant") {
      comparison = Number(Boolean(second.featured)) - Number(Boolean(first.featured));
    }
    return comparison || first.id.localeCompare(second.id);
  });

  const start = (filters.page - 1) * filters.pageSize;
  return {
    products: products.slice(start, start + filters.pageSize),
    facets,
    total: products.length,
    page: filters.page,
    pageSize: filters.pageSize,
    source: "demo"
  };
};
