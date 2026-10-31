import type { Metadata } from "next";
import { BRAND_NAME, officialUrl } from "./seo";

export function catalogMetadata({
  title,
  description,
  path,
  indexable = true
}: {
  title: string;
  description: string;
  path: `/${string}`;
  indexable?: boolean;
}): Metadata {
  return {
    title,
    description,
    robots: { index: indexable, follow: true },
    alternates: { canonical: officialUrl(path) },
    openGraph: {
      title: `${title} | ${BRAND_NAME}`,
      description,
      type: "website",
      siteName: BRAND_NAME,
      locale: "pt_BR",
      url: officialUrl(path)
    },
    twitter: { card: "summary", title: `${title} | ${BRAND_NAME}`, description }
  };
}
