import { JsonLd } from "./json-ld";
import { BRAND_NAME, breadcrumbStructuredData } from "@/lib/seo";

export function CatalogSeo({ name, path }: { name: string; path: `/${string}` }) {
  return (
    <JsonLd
      data={breadcrumbStructuredData([
        { name: BRAND_NAME, path: "/" },
        { name, path }
      ])}
    />
  );
}
