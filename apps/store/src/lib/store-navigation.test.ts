import { describe, expect, it } from "vitest";
import { activeNavigationItemId, isNavigationItemActive, navigationHref, serializeStoreNavigation, type StoreNavigationItem } from "./store-navigation-core";

const navigation: StoreNavigationItem[] = [
  { id: "home", label: "Início", href: "/", placement: "main" },
  { id: "products", label: "Produtos", href: "/produtos", placement: "main" },
  { id: "female", label: "Feminino", href: "/produtos?categoria=feminino", placement: "main" },
  { id: "kits", label: "Kits", href: "/produtos?categoria=kits", placement: "main" },
  { id: "sandals", label: "Chinelos", href: "/produtos?categoria=chinelos", placement: "main" },
  { id: "help", label: "Atendimento", href: "/ajuda", placement: "utility" }
];

describe("navegação configurável da loja", () => {
  it.each([
    ["/", "", "home"],
    ["/produtos", "", "products"],
    ["/produtos", "categoria=feminino", "female"],
    ["/produtos", "categoria=kits", "kits"],
    ["/produtos", "categoria=chinelos&cor=preto", "sandals"],
    ["/ajuda", "", "help"]
  ])("marca só o item correto em %s?%s", (pathname, query, expected) => {
    const params = new URLSearchParams(query);
    expect(activeNavigationItemId(navigation, pathname, params)).toBe(expected);
    expect(navigation.filter((item) => isNavigationItemActive(item.href, pathname, params)).map((item) => item.id)).toEqual([expected]);
  });

  it("reconhece categorias futuras sem código específico", () => {
    const newCategory = { id: "future", label: "Nova categoria", href: "/produtos?categoria=nova-categoria", placement: "main" as const };
    expect(activeNavigationItemId([...navigation, newCategory], "/produtos", new URLSearchParams("categoria=nova-categoria&cor=azul"))).toBe("future");
    expect(activeNavigationItemId(navigation, "/produtos", new URLSearchParams("categoria=nova-categoria"))).toBeUndefined();
  });
  it("monta destinos de categoria e coleção", () => {
    expect(navigationHref({ destination_type: "category", destination_value: "sandalias" }))
      .toBe("/produtos?categoria=sandalias");
    expect(navigationHref({ destination_type: "collection", destination_value: "verao 27" }))
      .toBe("/produtos?colecao=verao%2027");
  });

  it("rejeita URL externa e preserva somente itens válidos na ordem recebida", () => {
    expect(navigationHref({ destination_type: "internal_url", destination_value: "https://x.test" }))
      .toBeNull();
    expect(serializeStoreNavigation([
      { id: "1", label: "Início", placement: "main", destination_type: "page", destination_value: "/" },
      { id: "2", label: "Perigoso", destination_type: "internal_url", destination_value: "//x.test" },
      { id: "3", label: "Ajuda", placement: "utility", destination_type: "page", destination_value: "/ajuda" }
    ])).toEqual([
      { id: "1", label: "Início", href: "/", placement: "main" },
      { id: "3", label: "Ajuda", href: "/ajuda", placement: "utility" }
    ]);
  });
});
