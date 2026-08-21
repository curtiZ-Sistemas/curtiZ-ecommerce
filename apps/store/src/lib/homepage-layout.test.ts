import { describe, expect, it } from "vitest";
import type { HomepageSection } from "@curtiz/domain";
import { selectHomepageSections } from "./homepage-layout";

const section = (
  id: string,
  sectionType: HomepageSection["sectionType"] = "benefits"
): HomepageSection => ({
  id,
  sectionType,
  layout: "four_columns",
  visibility: "all",
  style: {},
  content: {},
  settings: {},
  items: [],
  active: true,
  sortOrder: 1
});

describe("selectHomepageSections", () => {
  const published = [section("published")];
  const defaults = [section("default")];

  it("preserva a publicação válida do construtor", () => {
    expect(selectHomepageSections(published, defaults, true, false)).toBe(published);
  });

  it("usa o layout padrão quando existem dados públicos reais", () => {
    expect(selectHomepageSections([], defaults, true, false)).toBe(defaults);
  });

  it("mantém indisponível quando não existe publicação nem conteúdo público", () => {
    expect(selectHomepageSections([], defaults, false, false)).toEqual([]);
  });

  it("mantém somente a primeira Hero publicada", () => {
    const firstHero = section("hero-principal", "banner_hero");
    const secondHero = section("hero-duplicada", "banner_hero");
    const benefits = section("beneficios");

    expect(
      selectHomepageSections(
        [firstHero, benefits, secondHero],
        defaults,
        true,
        false
      )
    ).toEqual([firstHero, benefits]);
  });

  it("posiciona Para todos os momentos logo abaixo dos benefícios", () => {
    const hero = section("hero", "banner_hero");
    const occasions = {
      ...section("categorias", "categories_grid"),
      title: "Para todos os momentos"
    };
    const benefits = section("beneficios");
    const featured = section("destaques", "product_carousel");

    expect(
      selectHomepageSections(
        [hero, occasions, featured, benefits],
        defaults,
        true,
        false
      )
    ).toEqual([hero, featured, benefits, occasions]);
  });
});
