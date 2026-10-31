import { CatalogPage } from "@/components/catalog-page";
import { CatalogSeo } from "@/components/catalog-seo";
import { catalogMetadata } from "@/lib/catalog-metadata";
import { hasPublicCatalogItems } from "@/lib/seo-data";

const description = "Confira os chinelos e kits de chinelos mais recentes do catálogo curti Z.";
export async function generateMetadata() {
  return catalogMetadata({
    title: "Lançamentos",
    description,
    path: "/lancamentos",
    indexable: await hasPublicCatalogItems()
  });
}

export default function Page() {
  return (
    <>
      <CatalogSeo name="Lançamentos" path="/lancamentos" />
      <CatalogPage title="Lançamentos curti Z" description={description} preset="newest" />
    </>
  );
}
