import { CatalogPage } from "@/components/catalog-page";
import { CatalogSeo } from "@/components/catalog-seo";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description =
  "Veja chinelos e sandálias infantis curti Z com conforto e praticidade para acompanhar cada descoberta.";
export const metadata = catalogMetadata({
  title: "Chinelos e sandálias infantis",
  description,
  path: "/infantil"
});

export default function Page() {
  return (
    <>
      <CatalogSeo name="Infantil" path="/infantil" />
      <CatalogPage
        title="Chinelos e sandálias infantis"
        description={description}
        category="Infantil"
      />
    </>
  );
}
