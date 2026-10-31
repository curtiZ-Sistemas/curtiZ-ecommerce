import { CatalogPage } from "@/components/catalog-page";
import { CatalogSeo } from "@/components/catalog-seo";
import { catalogMetadata } from "@/lib/catalog-metadata";
import { hasPublicCatalogItems } from "@/lib/seo-data";

const description = "Consulte a disponibilidade da seleção masculina no catálogo curti Z.";
export async function generateMetadata() {
  return catalogMetadata({
    title: "Masculino",
    description,
    path: "/masculino",
    indexable: await hasPublicCatalogItems("Masculino")
  });
}

export default function Page() {
  return (
    <>
      <CatalogSeo name="Masculino" path="/masculino" />
      <CatalogPage title="Masculino" description={description} category="Masculino" />
    </>
  );
}
