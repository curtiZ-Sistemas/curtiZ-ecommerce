import { CatalogPage } from "@/components/catalog-page";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description = "Ajuste, leveza e acabamento cuidadoso.";
export const metadata = catalogMetadata({ title: "Sandálias", description, path: "/sandalias" });

export default function Page() {
  return <CatalogPage title="Sandálias" description={description} category="Sandálias" />;
}
