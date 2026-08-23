export const searchHistoryLimit = 5;

export function normalizeSearchTerm(value: string) {
  return value.replace(/\s+/gu, " ").trim().slice(0, 100);
}
export function parseSearchHistory(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = normalizeSearchTerm(item);
    const key = normalized.toLocaleLowerCase("pt-BR");
    if (normalized && !unique.has(key)) unique.set(key, normalized);
    if (unique.size === searchHistoryLimit) break;
  }
  return [...unique.values()];
}

export function rememberSearch(history: readonly string[], value: string) {
  const normalized = normalizeSearchTerm(value);
  if (!normalized) return [...history].slice(0, searchHistoryLimit);
  const key = normalized.toLocaleLowerCase("pt-BR");
  return [
    normalized,
    ...history.filter((item) => item.toLocaleLowerCase("pt-BR") !== key)
  ].slice(0, searchHistoryLimit);
}
