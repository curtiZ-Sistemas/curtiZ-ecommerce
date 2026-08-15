import { CatalogPage } from "@/components/catalog-page";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description = "Praticidade com personalidade.";
export const metadata = catalogMetadata({ title: "Slides", description, path: "/slides" });

export default function Page() {
  return <CatalogPage title="Slides" description={description} category="Slides" />;
}
