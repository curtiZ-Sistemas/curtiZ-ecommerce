import { CatalogPage } from "@/components/catalog-page";
import { CatalogSeo } from "@/components/catalog-seo";
import { catalogMetadata } from "@/lib/catalog-metadata";
import { hasPublicCatalogItems } from "@/lib/seo-data";

const description = "Consulte a disponibilidade da seleção infantil no catálogo curti Z.";
export async function generateMetadata() {
  return catalogMetadata({
    title: "Infantil",
    description,
    path: "/infantil",
    indexable: await hasPublicCatalogItems("Infantil")
  });
}

export default function Page() {
  return (
    <>
      <CatalogSeo name="Infantil" path="/infantil" />
      <CatalogPage title="Infantil" description={description} category="Infantil" />
    </>
  );
}
