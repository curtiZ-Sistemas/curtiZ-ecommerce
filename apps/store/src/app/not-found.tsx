import { ArrowLeft, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { ErrorPageShell } from "@/components/error-page-shell";
import { ErrorRecommendations } from "@/components/error-recommendations";
import ProductNotFound from "./produto/[slug]/not-found";

export default async function NotFound() {
  const requestHeaders = await headers();

  if (requestHeaders.get("x-curtiz-not-found-kind") === "product") {
    return <ProductNotFound />;
  }

  return (
    <ErrorPageShell
      code="404"
      eyebrow="Página não encontrada"
      title="Não encontramos esta página."
      description="O endereço pode ter mudado, estar incorreto ou não existir mais."
      actions={
        <>
          <Link className="primary-button" href="/">
            <ArrowLeft aria-hidden="true" /> Voltar ao início
          </Link>
          <Link className="secondary-button" href="/produtos">
            <ShoppingBag aria-hidden="true" /> Continuar comprando
          </Link>
        </>
      }
    >
      <ErrorRecommendations />
    </ErrorPageShell>
  );
}
