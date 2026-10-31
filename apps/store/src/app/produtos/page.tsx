import { CatalogPage } from "@/components/catalog-page";
import { CatalogSeo } from "@/components/catalog-seo";
import { catalogMetadata } from "@/lib/catalog-metadata";
import { hasPublicCatalogItems } from "@/lib/seo-data";

const description =
  "Explore chinelos e kits de chinelos curti Z. Consulte cores, tamanhos e disponibilidade dos produtos no catálogo.";
export async function generateMetadata() {
  return catalogMetadata({
    title: "Chinelos e kits de chinelos",
    description,
    path: "/produtos",
    indexable: await hasPublicCatalogItems()
  });
}

export default function Page() {
  return (
    <>
      <CatalogSeo name="Produtos" path="/produtos" />
      <CatalogPage title="Todos os produtos curti Z" description={description} />
    </>
  );
}
