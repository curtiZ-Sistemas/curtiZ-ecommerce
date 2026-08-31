import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { officialUrl } from "../lib/seo";

export function buildRobots(hostname: string): MetadataRoute.Robots {
  if (hostname.toLowerCase().endsWith(".workers.dev")) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/auth/",
          "/carrinho",
          "/checkout",
          "/favoritos",
          "/minha-conta",
          "/perfil",
          "/pedido/",
          "/login",
          "/cadastro",
          "/esqueci-senha",
          "/redefinir-senha",
          "/mfa",
          "/representante/",
          "/privacidade/solicitacoes"
        ]
      }
    ],
    sitemap: officialUrl("/sitemap.xml")
  };
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  const requestHeaders = await headers();
  const hostname = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "")
    .split(":")[0]
    ?.toLowerCase();
  return buildRobots(hostname ?? "");
}
