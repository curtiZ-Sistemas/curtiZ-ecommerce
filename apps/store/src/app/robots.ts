import type { MetadataRoute } from "next";
import { configuredPublicAppUrls } from "@curtiz/config";
import { headers } from "next/headers";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const requestHeaders = await headers();
  const hostname = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "")
    .split(":")[0]
    ?.toLowerCase();
  const base = configuredPublicAppUrls().storeUrl;
  if (hostname?.endsWith(".workers.dev")) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
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
