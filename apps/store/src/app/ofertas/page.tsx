import { CatalogPage } from "@/components/catalog-page";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description = "Preços especiais por tempo limitado.";
export const metadata = catalogMetadata({ title: "Ofertas", description, path: "/ofertas" });

export default function Page() {
  return <CatalogPage title="Ofertas" description={description} preset="promotion" />;
}
