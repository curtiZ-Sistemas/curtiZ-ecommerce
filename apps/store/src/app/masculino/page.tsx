import { CatalogPage } from "@/components/catalog-page";
import { CatalogSeo } from "@/components/catalog-seo";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description =
  "Conheça chinelos e slides masculinos curti Z com conforto, praticidade e estilo para todos os dias.";
export const metadata = catalogMetadata({
  title: "Chinelos e slides masculinos",
  description,
  path: "/masculino"
});

export default function Page() {
  return (
    <>
      <CatalogSeo name="Masculino" path="/masculino" />
      <CatalogPage
        title="Chinelos e slides masculinos"
        description={description}
        category="Masculino"
      />
    </>
  );
}
