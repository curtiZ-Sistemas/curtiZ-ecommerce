import { describe, expect, it } from "vitest";
import { normalizeSearchTerm, parseSearchHistory, rememberSearch } from "./search-history";

describe("search history", () => {
  it("normaliza espaços, remove duplicados e mantém os cinco mais recentes", () => {
    expect(
      parseSearchHistory(["  Slide   preto ", "slide preto", "Chinelo", "A", "B", "C", "D"])
    ).toEqual(["Slide preto", "Chinelo", "A", "B", "C"]);
  });

  it("move uma pesquisa repetida para o topo sem diferenciar maiúsculas", () => {
    expect(rememberSearch(["Slides", "Sandália"], "  sandália ")).toEqual([
      "sandália",
      "Slides"
    ]);
  });

  it("limita e higieniza o termo confirmado", () => {
    expect(normalizeSearchTerm("  chinelo   azul  ")).toBe("chinelo azul");
    expect(rememberSearch(["1", "2", "3", "4", "5"], "6")).toEqual([
      "6",
      "1",
      "2",
      "3",
      "4"
    ]);
  });
});
