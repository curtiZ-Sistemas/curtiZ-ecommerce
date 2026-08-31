import { CatalogPage } from "@/components/catalog-page";
import { CatalogSeo } from "@/components/catalog-seo";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description =
  "Encontre slides curti Z confortáveis e versáteis, com cores e modelos para usar dentro e fora de casa.";
export const metadata = catalogMetadata({ title: "Slides", description, path: "/slides" });

export default function Page() {
  return (
    <>
      <CatalogSeo name="Slides" path="/slides" />
      <CatalogPage title="Slides curti Z" description={description} category="Slides" />
    </>
  );
}
