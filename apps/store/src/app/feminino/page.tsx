import { CatalogPage } from "@/components/catalog-page";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description = "Leveza, cor e design em cada passo.";
export const metadata = catalogMetadata({ title: "Feminino", description, path: "/feminino" });

export default function Page() {
  return <CatalogPage title="Feminino" description={description} category="Feminino" />;
}
