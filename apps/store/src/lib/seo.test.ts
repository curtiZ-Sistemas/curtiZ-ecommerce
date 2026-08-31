import type { Product } from "@curtiz/domain";
import { describe, expect, it } from "vitest";
import { catalogMetadata } from "./catalog-metadata";
import {
  BRAND_ALTERNATE_NAMES,
  BRAND_NAME,
  catalogNavigationStructuredData,
  homeMetadata,
  officialUrl,
  organizationStructuredData,
  productBreadcrumbStructuredData,
  productMetadata,
  productStructuredData,
  searchMetadata,
  serializeJsonLd,
  websiteStructuredData
} from "./seo";

const product: Product = {
  id: "produto-1",
  slug: "slide-wave-preto",
  name: "Slide Wave Preto",
  category: "Slides",
  description: "Slide leve e confortável para todos os dias.",
  priceInCents: 7990,
  rating: 0,
  reviews: 0,
  colors: ["Preto"],
  sizes: ["37", "38"],
  image: "https://images.example/slide-wave-preto.webp",
  stock: 4
};

const detail = {
  product,
  gallery: [{ src: product.image }],
  variants: [
    { priceInCents: 7990, stock: 0 },
    { priceInCents: 7490, stock: 4 }
  ]
};

describe("SEO da loja", () => {
  it("usa somente o domínio oficial em canonicals da home e das categorias", () => {
    const category = catalogMetadata({
      title: "Feminino",
      description: "Produtos femininos curti Z.",
      path: "/feminino"
    });

    expect(officialUrl("/feminino")).toBe("https://curtiz.com.br/feminino");
    expect(homeMetadata.alternates).toEqual({ canonical: "https://curtiz.com.br/" });
    expect(category.alternates).toEqual({ canonical: "https://curtiz.com.br/feminino" });
    expect(JSON.stringify(category)).not.toContain("workers.dev");
  });

  it("declara a entidade real da marca e suas grafias alternativas", () => {
    expect(websiteStructuredData.name).toBe(BRAND_NAME);
    expect(organizationStructuredData.name).toBe(BRAND_NAME);
    expect(websiteStructuredData.alternateName).toEqual([...BRAND_ALTERNATE_NAMES]);
    expect(organizationStructuredData.url).toBe("https://curtiz.com.br/");
    expect(catalogNavigationStructuredData.itemListElement).toHaveLength(9);
  });

  it("impede indexação de URLs arbitrárias da busca interna", () => {
    expect(searchMetadata.robots).toEqual({ index: false, follow: true });
  });

  it("gera metadata, Product, Offer e breadcrumbs com dados reais do produto", () => {
    const metadata = productMetadata(detail);
    const schema = productStructuredData(detail);
    const breadcrumb = productBreadcrumbStructuredData(product);

    expect(metadata.title).toEqual({ absolute: "Slide Wave Preto | curti Z" });
    expect(metadata.alternates).toEqual({
      canonical: "https://curtiz.com.br/produto/slide-wave-preto"
    });
    expect(schema).toMatchObject({
      "@type": "Product",
      name: product.name,
      category: "Slides",
      brand: { "@type": "Brand", name: "curti Z" },
      offers: {
        "@type": "Offer",
        price: "74.90",
        priceCurrency: "BRL",
        availability: "https://schema.org/InStock"
      }
    });
    expect(schema).not.toHaveProperty("aggregateRating");
    expect(breadcrumb.itemListElement.map((item) => item.item)).toEqual([
      "https://curtiz.com.br/",
      "https://curtiz.com.br/slides",
      "https://curtiz.com.br/produto/slide-wave-preto"
    ]);
  });

  it("escapa conteúdo perigoso ao serializar JSON-LD", () => {
    expect(serializeJsonLd({ value: "</script>" })).not.toContain("</script>");
  });
});
