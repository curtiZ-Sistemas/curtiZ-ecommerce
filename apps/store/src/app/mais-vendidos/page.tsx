import { CatalogPage } from "@/components/catalog-page";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description = "Os favoritos de quem escolhe curti Z.";
export const metadata = catalogMetadata({ title: "Mais vendidos", description, path: "/mais-vendidos" });

export default function Page() {
  return <CatalogPage title="Mais vendidos" description={description} preset="best_sellers" />;
}
