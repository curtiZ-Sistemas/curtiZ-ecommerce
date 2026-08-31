import { CatalogSeo } from "@/components/catalog-seo";
import { catalogMetadata } from "@/lib/catalog-metadata";
import { FemininoCatalog } from "./feminino-catalog";

const description =
  "Descubra chinelos e sandálias femininas curti Z com leveza, cores atuais e conforto para acompanhar sua rotina.";
export const metadata = catalogMetadata({
  title: "Chinelos e sandálias femininas",
  description,
  path: "/feminino"
});

export default function Page() {
  return (
    <>
      <CatalogSeo name="Feminino" path="/feminino" />
      <FemininoCatalog description={description} />
    </>
  );
}
