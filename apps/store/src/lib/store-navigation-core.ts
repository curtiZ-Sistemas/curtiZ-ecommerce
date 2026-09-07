export type StoreNavigationItem = {
  id: string;
  label: string;
  href: string;
  placement: "main" | "utility";
};

type NavigationRow = Record<string, unknown>;

export const fallbackStoreNavigation: StoreNavigationItem[] = [
  { id: "fallback-home", label: "Início", href: "/", placement: "main" },
  { id: "fallback-products", label: "Produtos", href: "/produtos", placement: "main" },
  { id: "fallback-help", label: "Atendimento", href: "/ajuda", placement: "utility" }
];

const internalPath = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    [...path].some((character) => character.charCodeAt(0) < 32)
  ) return null;
  return path;
};

export function navigationHref(row: NavigationRow): string | null {
  const value = typeof row.destination_value === "string" ? row.destination_value.trim() : "";
  if (!value) return null;
  if (row.destination_type === "category") return `/produtos?categoria=${encodeURIComponent(value)}`;
  if (row.destination_type === "collection") return `/produtos?colecao=${encodeURIComponent(value)}`;
  if (row.destination_type === "page" || row.destination_type === "internal_url") return internalPath(value);
  return null;
}

export function serializeStoreNavigation(value: unknown): StoreNavigationItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const row = candidate as NavigationRow;
    const href = navigationHref(row);
    const id = typeof row.id === "string" ? row.id : "";
    const label = typeof row.label === "string" ? row.label.trim() : "";
    const placement = row.placement === "utility" ? "utility" : "main";
    return id && label && href ? [{ id, label, href, placement }] : [];
  });
}
