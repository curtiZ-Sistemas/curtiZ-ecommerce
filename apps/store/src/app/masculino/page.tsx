import { CatalogPage } from "@/components/catalog-page";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description = "Conforto e versatilidade para todos os dias.";
export const metadata = catalogMetadata({ title: "Masculino", description, path: "/masculino" });

export default function Page() {
  return <CatalogPage title="Masculino" description={description} category="Masculino" />;
}
