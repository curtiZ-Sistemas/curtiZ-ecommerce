import { CatalogPage } from "@/components/catalog-page";
import { CatalogSeo } from "@/components/catalog-seo";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description =
  "Conheça as sandálias curti Z com ajuste confortável, leveza e acabamento pensado para a rotina.";
export const metadata = catalogMetadata({ title: "Sandálias", description, path: "/sandalias" });

export default function Page() {
  return (
    <>
      <CatalogSeo name="Sandálias" path="/sandalias" />
      <CatalogPage title="Sandálias curti Z" description={description} category="Sandálias" />
    </>
  );
}
