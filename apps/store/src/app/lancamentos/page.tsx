import { CatalogPage } from "@/components/catalog-page";
import { catalogMetadata } from "@/lib/catalog-metadata";

const description = "As novidades mais recentes da curti Z.";
export const metadata = catalogMetadata({ title: "Lançamentos", description, path: "/lancamentos" });

export default function Page() {
  return <CatalogPage title="Lançamentos" description={description} preset="newest" />;
}
