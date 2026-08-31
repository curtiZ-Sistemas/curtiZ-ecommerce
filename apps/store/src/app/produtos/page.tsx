import { CatalogPage } from "@/components/catalog-page";
import { CatalogSeo } from "@/components/catalog-seo";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description =
  "Explore chinelos, slides e sandálias curti Z e encontre cores, tamanhos e estilos para cada momento.";
export const metadata = catalogMetadata({
  title: "Chinelos, slides e sandálias",
  description,
  path: "/produtos"
});

export default function Page() {
  return (
    <>
      <CatalogSeo name="Produtos" path="/produtos" />
      <CatalogPage title="Todos os produtos curti Z" description={description} />
    </>
  );
}
