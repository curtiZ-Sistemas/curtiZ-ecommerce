import type { MetadataRoute } from "next";
import { getActiveProductSitemapEntries } from "@/lib/seo-data";
import { officialUrl } from "../lib/seo";

export const dynamic = "force-dynamic";

export const SITEMAP_STATIC_ROUTES = [
  "",
  "/produtos",
  "/masculino",
  "/feminino",
  "/infantil",
  "/slides",
  "/sandalias",
  "/lancamentos",
  "/ofertas",
  "/mais-vendidos",
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

  return [
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
