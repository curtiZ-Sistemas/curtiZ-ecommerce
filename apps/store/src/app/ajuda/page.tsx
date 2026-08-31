import { HelpCenter } from "@/components/help-center";
import { catalogMetadata } from "@/lib/catalog-metadata";

export const metadata = catalogMetadata({
  title: "Central de ajuda",
  description: "Encontre respostas e atendimento para sua compra na loja oficial curti Z.",
  path: "/ajuda"
});

export default function HelpPage() {
  return <HelpCenter />;
}
