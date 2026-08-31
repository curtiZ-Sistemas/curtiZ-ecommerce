import { CatalogPage } from "@/components/catalog-page";
import { CatalogSeo } from "@/components/catalog-seo";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description =
  "Aproveite ofertas reais em chinelos, slides e sandálias curti Z, sempre conforme a disponibilidade do catálogo.";
export const metadata = catalogMetadata({ title: "Ofertas", description, path: "/ofertas" });

export default function Page() {
  return (
    <>
      <CatalogSeo name="Ofertas" path="/ofertas" />
      <CatalogPage title="Ofertas curti Z" description={description} preset="promotion" />
    </>
  );
}
