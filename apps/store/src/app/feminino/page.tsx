import { catalogMetadata } from "@/lib/catalog-metadata";
import { FemininoCatalog } from "./feminino-catalog";

const description = "Leveza, cor e design em cada passo.";
export const metadata = catalogMetadata({ title: "Feminino", description, path: "/feminino" });

export default function Page() {
  return <FemininoCatalog description={description} />;
}
