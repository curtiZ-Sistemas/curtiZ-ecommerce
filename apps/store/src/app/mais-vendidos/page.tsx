import { CatalogPage } from "@/components/catalog-page";
import { CatalogSeo } from "@/components/catalog-seo";
import { catalogMetadata } from "@/lib/catalog-metadata";
import { hasPublicCatalogItems } from "@/lib/seo-data";

const description =
  "Explore chinelos e kits de chinelos curti Z ordenados pelos mais vendidos do catálogo.";
export async function generateMetadata() {
  return catalogMetadata({
    title: "Mais vendidos",
    description,
    path: "/mais-vendidos",
    indexable: await hasPublicCatalogItems()
  });
}

export default function Page() {
  return (
    <>
      <CatalogSeo name="Mais vendidos" path="/mais-vendidos" />
      <CatalogPage
        title="Mais vendidos da curti Z"
        description={description}
        preset="best_sellers"
      />
    </>
  );
}
