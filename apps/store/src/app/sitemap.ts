import type { MetadataRoute } from "next";
import { getActiveProductSitemapEntries, hasPublicCatalogItems } from "@/lib/seo-data";
import { officialUrl } from "../lib/seo";

export const dynamic = "force-dynamic";

export const SITEMAP_STATIC_ROUTES = [
  "",
  "/sobre",
  "/contato",
  "/ajuda",
  "/politicas",
  "/trocas-e-devolucoes",
  "/formas-de-envio",
  "/formas-de-pagamento"
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await getActiveProductSitemapEntries();
  const catalogRoutes = await Promise.all(([
    ["/produtos", undefined, false],
    ["/feminino", "Feminino", false],
    ["/masculino", "Masculino", false],
    ["/infantil", "Infantil", false],
    ["/lancamentos", undefined, false],
    ["/ofertas", undefined, true],
    ["/mais-vendidos", undefined, false]
  ] as const).map(async ([path, category, promotion]) => ({
    path,
    indexable: await hasPublicCatalogItems(category, promotion)
  })));

  return [
    ...catalogRoutes.filter((route) => route.indexable).map((route) => ({ url: officialUrl(route.path), changeFrequency: "daily" as const })),
    ...SITEMAP_STATIC_ROUTES.map((route) => ({
      url: officialUrl(route || "/"),
      changeFrequency: "weekly" as const
    })),
    ...products.map((product) => ({
      url: officialUrl(`/produto/${encodeURIComponent(product.slug)}`),
      changeFrequency: "daily" as const,
      ...(product.updatedAt ? { lastModified: new Date(product.updatedAt) } : {})
    }))
  ];
}
