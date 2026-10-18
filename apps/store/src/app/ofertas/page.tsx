import { CatalogPage } from "@/components/catalog-page";
import { CatalogSeo } from "@/components/catalog-seo";
import { catalogMetadata } from "@/lib/catalog-metadata";
import { hasPublicCatalogItems } from "@/lib/seo-data";

const description =
  "Consulte as ofertas de chinelos e kits de chinelos curti Z conforme preços e disponibilidade do catálogo.";
export async function generateMetadata() {
  return catalogMetadata({
    title: "Ofertas",
    description,
    path: "/ofertas",
    indexable: await hasPublicCatalogItems(undefined, true)
  });
}

export default function Page() {
  return (
    <>
      <CatalogSeo name="Ofertas" path="/ofertas" />
      <CatalogPage title="Ofertas curti Z" description={description} preset="promotion" />
    </>
  );
}
