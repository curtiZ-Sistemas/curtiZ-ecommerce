import type { MetadataRoute } from "next";
import { demoProducts } from "@/lib/catalog";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000";
  const routes = ["", "/produtos", "/masculino", "/feminino", "/infantil", "/slides", "/sandalias", "/lancamentos", "/ofertas", "/mais-vendidos", "/sobre", "/ajuda"];
  return [
    ...routes.map((route) => ({ url: `${base}${route}`, changeFrequency: "weekly" as const })),
    ...demoProducts.map((product) => ({
      url: `${base}/produto/${product.slug}`,
      changeFrequency: "daily" as const
    }))
  ];
}
