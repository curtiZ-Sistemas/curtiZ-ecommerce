import { CatalogPage } from "@/components/catalog-page";
import { CatalogSeo } from "@/components/catalog-seo";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description =
  "Confira os lançamentos curti Z e descubra os modelos mais recentes de chinelos, slides e sandálias.";
export const metadata = catalogMetadata({ title: "Lançamentos", description, path: "/lancamentos" });

export default function Page() {
  return (
    <>
      <CatalogSeo name="Lançamentos" path="/lancamentos" />
      <CatalogPage title="Lançamentos curti Z" description={description} preset="newest" />
    </>
  );
}
