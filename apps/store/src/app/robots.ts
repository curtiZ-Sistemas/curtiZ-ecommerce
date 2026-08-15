import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000").replace(/\/+$/u, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/carrinho", "/checkout", "/minha-conta", "/login", "/cadastro"]
      }
    ],
    sitemap: `${base}/sitemap.xml`
  };
}
