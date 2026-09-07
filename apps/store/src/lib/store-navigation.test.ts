import { describe, expect, it } from "vitest";
import { navigationHref, serializeStoreNavigation } from "./store-navigation-core";

describe("navegação configurável da loja", () => {
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
