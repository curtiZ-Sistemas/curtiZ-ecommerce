import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CategoryCarousel } from "./category-carousel";
import { HomepageHero } from "./homepage-hero";
import { ProductCard } from "./product-card";
import { ProductPurchase } from "./product-purchase";
import { SearchAutocomplete } from "./search-autocomplete";
import ErrorPage from "../app/error";
import GlobalError from "../app/global-error";
import type { PublicBanner } from "@/lib/storefront-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("q=teste-inicial")
}));
vi.mock("./favorites-provider", () => ({
  useFavorites: () => ({ hydrated: true, has: () => false, toggle: vi.fn() })
}));
vi.mock("./cart-provider", () => ({
  useCart: () => ({ add: vi.fn() })
}));
vi.stubGlobal("React", React);

const banners: PublicBanner[] = [
  {
    id: "hero-1",
    title: "Coleção curti Z",
    altText: "Coleção curti Z",
    desktopImage: "/images/hero-curtiz-desktop.png",
    mobileImage: "/images/hero-curtiz-mobile.png",
    href: "/lancamentos",
    position: "hero"
  },
  {
    id: "hero-2",
    title: "Seleção de produtos",
    altText: "Seleção de produtos",
    desktopImage: "/images/hero-curtiz-desktop.png",
    mobileImage: "/images/hero-curtiz-mobile.png",
    href: "/produtos",
    position: "hero"
  }
];

describe("public storefront components", () => {
  it("renderiza imagens distintas do hero para desktop e celular", () => {
    const html = renderToStaticMarkup(<HomepageHero banners={banners} />);

    expect(html).toContain('class="hero-media"');
    expect(html).toContain('media="(max-width: 700px)"');
    expect(html).toContain('srcSet="/images/optimized/hero-mobile.430.avif 430w');
    expect(html).toContain('aria-label="Banner anterior"');
    expect(html).toContain('aria-label="Próximo banner"');
    expect(html).not.toContain("Pausar banners");
    expect(html).not.toContain("Automático");
    expect(html).toContain('src="/images/hero-curtiz-desktop.webp');
    expect(html).toContain('width="941" height="1672"');
    expect(html).toContain('aria-label="Controles dos banners"');
    expect(html).toContain('href="/lancamentos"');
  });

  it("não cria link decorativo quando o banner não possui destino", () => {
    const html = renderToStaticMarkup(
      <HomepageHero banners={[{ ...banners[0]!, href: undefined }]} />
    );
    expect(html).not.toContain("<a");
    expect(html).toContain("hero-picture");
  });

  it("expõe uma busca acessível com autocomplete", () => {
    const html = renderToStaticMarkup(<SearchAutocomplete idPrefix="test" />);

    expect(html).toContain('role="search"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('value="teste-inicial"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('action="/busca"');
    expect(html).toContain('placeholder="Qual pegada você vai curti?"');
    expect(html).toContain('type="submit" aria-label="Buscar"');
    expect(html).not.toContain(">Buscar</button>");
  });

  it("mostra produto disponível sem revelar quantidade ou texto de estoque", () => {
    const html = renderToStaticMarkup(
      <ProductCard
        product={{
          id: "produto-1",
          slug: "produto-disponivel",
          name: "Produto disponível",
          category: "Masculino",
          description: "Produto",
          priceInCents: 5990,
          rating: 4.8,
          reviews: 10,
          colors: ["Preto"],
          sizes: ["40"],
          image: "/images/products/wave-preto.png",
          stock: 1
        }}
      />
    );

    expect(html).toContain("Produto disponível");
    expect(html).toContain('title="Produto disponível"');
    expect(html.toLocaleLowerCase("pt-BR")).not.toContain("em estoque");
    expect(html.toLocaleLowerCase("pt-BR")).not.toContain("unidade");
    expect(html).toContain("product-card-cart-button");
    expect(html).toContain("Escolher cor e tamanho");
    expect(html).toContain("R$\u00a059,90");
    expect(html).not.toContain("Consulte as condições no produto");
  });

  it("renderiza um card virtual com imagem, preço e link da variação", () => {
    const html = renderToStaticMarkup(
      <ProductCard product={{
        id: "produto-1",
        storefrontKey: "produto-1:azul",
        variantId: "azul",
        slug: "chinelo-essential",
        name: "Chinelo Essential — Azul",
        category: "Masculino",
        description: "Produto",
        priceInCents: 6490,
        rating: 0,
        reviews: 0,
        colors: ["Azul"],
        sizes: ["37"],
        image: "/images/products/essential-azul.webp",
        stock: 2
      }} />
    );
    expect(html).toContain("Chinelo Essential — Azul");
    expect(html).toContain("essential-azul.webp");
    expect(html).toContain("R$\u00a064,90");
    expect(html).toContain("/produto/chinelo-essential?variant=azul");
    expect(html).not.toContain('class="rating"');
    expect(html).not.toContain("0 de 5");
  });

  it("liga cada apresentação visual à variante e à imagem da sua cor", () => {
    for (const color of ["Branco", "Preto"]) {
      const slug = color.toLocaleLowerCase("pt-BR");
      const image = `/images/products/essential-${slug}.webp`;
      const html = renderToStaticMarkup(<ProductCard product={{
        id: "produto-1", storefrontKey: `produto-1:${slug}`, variantId: `variante-${slug}`,
        variantColor: color, variantSize: "37", slug: "chinelo-essential", name: "Chinelo Essential",
        variantTitle: `Chinelo Essential ${color} — Leve e Confortável`,
        category: "Chinelos", description: "Produto", priceInCents: 6490,
        rating: 0, reviews: 0, colors: [color], sizes: ["37"], image, stock: 2
      }} />);
      expect(html).toContain(image);
      expect(html).toContain(`Chinelo Essential ${color} — Leve e Confortável`);
      expect(html).toContain(`/produto/chinelo-essential?variant=variante-${slug}&amp;color=${color}`);
    }
  });

  it.each([
    ["produto importado antigo", `https://catalog.example.test/storage/v1/object/public/catalog-public/products/imports/20000000-0000-4000-8000-000000000001/${"a".repeat(64)}.webp`],
    ["produto novo", "https://catalog.example.test/storage/v1/object/public/catalog-public/products/user/product/imagem.webp"]
  ])("renderiza %s com a URL original do Supabase", (_name, image) => {
    const html = renderToStaticMarkup(<ProductCard product={{
      id: "produto-imagem",
      slug: "produto-imagem",
      name: "Produto com imagem",
      category: "Chinelos",
      description: "Produto",
      priceInCents: 5990,
      rating: 0,
      reviews: 0,
      colors: ["Preto"],
      sizes: ["37"],
      image,
      stock: 2
    }} />);

    expect(html).toContain(`src="${image}"`);
    expect(html).not.toContain("/media/product/");
    expect(html).not.toContain("/_next/image");
    expect(html).not.toContain("srcSet=");
    expect(html).toContain('width="720" height="720"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });

  it("mantém imagem direta quando uma categoria aponta para um produto", () => {
    const image = "https://catalog.example.test/storage/v1/object/public/catalog-public/products/user/product/imagem.webp";
    const html = renderToStaticMarkup(<CategoryCarousel categories={[{
      name: "Categoria",
      href: "/categorias/teste",
      image
    }]} />);

    expect(html).toContain(`src="${image}"`);
    expect(html).not.toContain("/media/product/");
    expect(html).not.toContain("srcSet=");
  });

  it("mantém a imagem original direta na página do produto", () => {
    const image = "https://catalog.example.test/storage/v1/object/public/catalog-public/products/user/product/imagem.webp";
    const product = {
      id: "produto-detalhe",
      slug: "produto-detalhe",
      name: "Produto detalhe",
      category: "Chinelos",
      description: "Produto",
      priceInCents: 5990,
      rating: 0,
      reviews: 0,
      colors: ["Preto"],
      sizes: ["37"],
      image,
      stock: 2
    };
    const html = renderToStaticMarkup(<ProductPurchase detail={{
      product,
      gallery: [{ id: "imagem", src: image, alt: product.name }],
      media: [],
      variants: [{ id: "variante", color: "Preto", size: "37", priceInCents: 5990, stock: 2, image }],
      specifications: [],
      sizeGuide: [],
      reviews: [],
      source: "supabase"
    }} initialVariantId="variante" />);

    expect(html).toContain(`src="${image}"`);
    expect(html).toContain('width="760" height="620"');
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchPriority="high"');
    expect(html).toContain('decoding="async"');
    expect(html).not.toContain("/media/product/");
    expect(html).not.toContain("/_next/image");
  });

  it("renderiza erros inesperados sem detalhes técnicos ou dados internos", () => {
    const pageError = renderToStaticMarkup(<ErrorPage reset={vi.fn()} />);
    const globalError = renderToStaticMarkup(<GlobalError reset={vi.fn()} />);
    const html = `${pageError}${globalError}`;

    expect(html).toContain("Algo não saiu como esperado.");
    expect(html).toContain("Não foi possível carregar a loja agora.");
    expect(html).toContain("Tentar novamente");
    expect(html).not.toMatch(/stack|supabase|sql|exception|token|service_role/iu);
  });
});
