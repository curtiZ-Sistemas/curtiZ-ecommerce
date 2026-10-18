import { CatalogSeo } from "@/components/catalog-seo";
import { catalogMetadata } from "@/lib/catalog-metadata";
import { FemininoCatalog } from "./feminino-catalog";
import { hasPublicCatalogItems } from "@/lib/seo-data";

const description =
  "Conheça os chinelos e kits de chinelos femininos curti Z. Consulte modelos, cores, tamanhos e disponibilidade no catálogo.";
export async function generateMetadata() {
  return catalogMetadata({
    title: "Chinelos e kits de chinelos femininos",
    description,
    path: "/feminino",
    indexable: await hasPublicCatalogItems("Feminino")
  });
}

export default function Page() {
  return (
    <>
      <CatalogSeo name="Feminino" path="/feminino" />
      <FemininoCatalog description={description} />
    </>
  );
}
