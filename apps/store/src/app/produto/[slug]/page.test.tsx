import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProductDetailData } from "@/lib/storefront-data";

vi.stubGlobal("React", React);

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) =>
  <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not_found"); } }));
vi.mock("@/components/product-purchase", () => ({ ProductPurchase: () => <div>Comprar</div> }));
vi.mock("@/components/intelligence-shelf", () => ({
  IntelligenceShelf: ({ excludeProductIds, trackingSource }: {
    excludeProductIds: string[]; trackingSource: string;
  }) => <div data-excluded={excludeProductIds.join(",")} data-source={trackingSource} />
}));
vi.mock("@/components/json-ld", () => ({ JsonLd: () => null }));
vi.mock("@/lib/seo", () => ({
  productCategoryPath: () => "/produtos",
  productMetadata: () => ({}),
  productStructuredData: () => ({}),
  productBreadcrumbStructuredData: () => ({})
}));
vi.mock("@/lib/storefront-data", () => ({ getPublicProduct: async () => detail }));
vi.mock("@/lib/product-description", () => import("../../../lib/product-description"));

import ProductPage from "./page";

const detail: ProductDetailData = {
  product: {
    id: "product-1", slug: "teste", name: "Produto de teste", category: "Sandálias",
    description: "## Cuidados\n\nLinha <script>\n- Confortável", priceInCents: 5000,
    rating: 0, reviews: 0, colors: [], sizes: [], image: "/test.webp", featured: false, stock: 1
  },
  gallery: [], media: [], variants: [],
  specifications: [{ label: "Marca", value: "Marca de teste" }, { label: "Material", value: "Borracha" }],
  sizeGuide: [{ size: "34", measurementCm: 23 }, { size: "35", measurementCm: 24.5 }],
  reviews: [], source: "supabase"
};

describe("product information", () => {
  it("shows ordered attributes, size guide and a separate readable description", async () => {
    const html = renderToStaticMarkup(await ProductPage({
      params: Promise.resolve({ slug: "teste" }), searchParams: Promise.resolve({})
    }));
    const details = html.indexOf("Detalhes do Produto");
    const brand = html.indexOf("Marca de teste");
    const material = html.indexOf("Borracha");
    const guide = html.indexOf("Guia de tamanhos");
    const description = html.indexOf(">Descrição<");
    expect(details).toBeGreaterThanOrEqual(0);
    expect(details).toBeLessThan(brand);
    expect(brand).toBeLessThan(material);
    expect(material).toBeLessThan(guide);
    expect(guide).toBeLessThan(description);
    expect(html.indexOf('class="product-facts-grid"')).toBeLessThan(html.indexOf('class="product-description-section"'));
    expect(html).toContain('class="product-description-content"');
    expect(html).toContain("24,5 cm");
    expect(html).not.toContain("cm cm");
    expect(html).toContain("Cuidados");
    expect(html).toContain("<h3>Cuidados</h3>");
    expect(html).toContain("<li>Confortável</li>");
    expect(html).toContain('data-excluded="product-1" data-source="product_detail"');
    expect(html).not.toContain("<script>");
  });
});
