import { CatalogPage } from "@/components/catalog-page";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description = "Explore a coleção completa curti Z.";
export const metadata = catalogMetadata({ title: "Todos os produtos", description, path: "/produtos" });

export default function Page() {
  return <CatalogPage title="Todos os produtos" description={description} />;
}
