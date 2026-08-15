import { CatalogPage } from "@/components/catalog-page";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description = "Conforto seguro para acompanhar as descobertas.";
export const metadata = catalogMetadata({ title: "Infantil", description, path: "/infantil" });

export default function Page() {
  return <CatalogPage title="Infantil" description={description} category="Infantil" />;
}
