import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HomepageSection } from "@curtiz/domain";
import type { HomepageData } from "@/lib/storefront-data";
import { HomepageSectionRenderer } from "./homepage-section-renderer";

vi.mock("./homepage-section-runtime", () => ({
  HomepageMetric: ({ children }: { children: React.ReactNode }) => children,
  HomepageCountdown: () => null
}));
vi.mock("./homepage-hero", () => ({ HomepageHero: () => null }));
vi.mock("./homepage-product-carousel", () => ({ HomepageProductCarousel: () => null }));
vi.mock("./category-carousel", () => ({ CategoryCarousel: () => null }));
vi.mock("./product-card", () => ({ ProductCard: () => null }));
vi.mock("./testimonial-carousel", () => ({ TestimonialCarousel: () => null }));
vi.mock("./intelligence-shelf", () => ({ IntelligenceShelf: () => null }));
vi.stubGlobal("React", React);

const questions = [
  ["Pergunta dinâmica A?", "Resposta completa para a primeira dúvida."],
  ["Pergunta dinâmica B?", "Resposta completa para a segunda dúvida."],
  ["Pergunta dinâmica C?", "Resposta completa para a terceira dúvida."],
  ["Pergunta dinâmica D?", "Resposta completa para a quarta dúvida."],
  ["Pergunta dinâmica E?", "Resposta completa para a quinta dúvida."],
  ["Pergunta dinâmica F?", "Resposta completa para a sexta dúvida."]
] as const;

const faqSection: HomepageSection = {
  id: "faq-v4",
  sectionType: "faq",
  title: "Dúvidas frequentes",
  subtitle: "Ajuda rápida antes de finalizar sua compra.",
  layout: "content_centered",
  visibility: "all",
  style: {},
  content: {},
  settings: {},
  items: questions.map(([title, description], index) => ({
    id: `faq-${index + 1}`,
    itemType: "faq",
    internalName: `pergunta-${index + 1}`,
    title,
    description,
    decorative: false,
    targetType: "none",
    sortOrder: index + 1,
    config: {},
    media: []
  })),
  active: true,
  sortOrder: 70
};

const homepageData: HomepageData = {
  sections: [faqSection],
  banners: [],
  products: [],
  categories: [],
  productsBySection: {},
  testimonials: [],
  source: "demo"
};

describe("FAQ da home", () => {
  it("renderiza os itens recebidos da seção e mantém o resumo compacto", () => {
    const html = renderToStaticMarkup(
      <HomepageSectionRenderer data={homepageData} section={faqSection} priority={false} />
    );

    expect(html).toContain("Ajuda rápida");
    expect(html).toContain("Dúvidas frequentes");
    expect(html).toContain("Ajuda rápida antes de finalizar sua compra.");
    for (const [question, answer] of questions) {
      expect(html).toContain(question);
      expect(html).toContain(answer);
    }
    expect((html.match(/<details\b/gu) ?? [])).toHaveLength(6);
    expect((html.match(/<summary\b/gu) ?? [])).toHaveLength(6);
    expect(html).toContain('aria-labelledby="faq-v4-title"');
    expect(html).not.toContain("<details open");
  });

  it("tem grid largo no desktop, uma coluna no mobile, foco visível e respostas legíveis", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

    expect(css).toContain("grid-template-columns: minmax(0, .95fr) minmax(0, 2fr)");
    expect(css).toMatch(/@media \(max-width: 760px\)\s*\{\s*\.home-faq \{ grid-template-columns: minmax\(0, 1fr\)/u);
    expect(css).toContain(".home-faq-list summary::-webkit-details-marker { display: none; }");
    expect(css).toContain(".home-faq-list summary::marker { content: \"\"; }");
    expect(css).toContain(".home-faq-list summary:focus-visible");
    expect(css).toContain(".home-faq-list details[open] .home-faq-toggle::before { content: \"−\"; }");
    expect(css).toContain("line-height: 1.7;");
    expect(css).toContain("overflow-wrap: anywhere;");
  });
});
