import { CatalogPage } from "@/components/catalog-page";
import { CatalogSeo } from "@/components/catalog-seo";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description =
  "Veja os chinelos, slides e sandálias mais vendidos da curti Z e encontre os favoritos de quem já escolheu a marca.";
export const metadata = catalogMetadata({ title: "Mais vendidos", description, path: "/mais-vendidos" });

export default function Page() {
  return (
    <>
      <CatalogSeo name="Mais vendidos" path="/mais-vendidos" />
      <CatalogPage title="Mais vendidos da curti Z" description={description} preset="best_sellers" />
    </>
  );
}
