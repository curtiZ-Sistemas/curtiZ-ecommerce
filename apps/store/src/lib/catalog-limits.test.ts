import { describe, expect, it } from "vitest";
import { parseCatalogFilters } from "./catalog-query";

describe("catalog payload limits", () => {
  it("aceita respostas auxiliares menores sem permitir consultas ilimitadas", () => {
    expect(parseCatalogFilters(new URLSearchParams("limite=4")).pageSize).toBe(4);
    expect(parseCatalogFilters(new URLSearchParams("limite=9999")).pageSize).toBe(24);
    expect(parseCatalogFilters(new URLSearchParams("limite=-10")).pageSize).toBe(1);
  });
});
