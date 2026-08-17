import { ArrowLeft, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { ErrorPageShell } from "@/components/error-page-shell";
import { ErrorRecommendations } from "@/components/error-recommendations";

export default function ProductNotFound() {
  return (
    <ErrorPageShell
      code="Produto"
      eyebrow="Item não encontrado"
      title="Produto não encontrado."
      description="Este produto pode ter sido retirado do catálogo ou não estar mais disponível neste endereço."
      actions={
        <>
          <Link className="primary-button" href="/produtos">
            <ShoppingBag aria-hidden="true" /> Ver outros produtos
          </Link>
          <Link className="secondary-button" href="/">
            <ArrowLeft aria-hidden="true" /> Voltar ao início
          </Link>
        </>
      }
    >
      <ErrorRecommendations />
    </ErrorPageShell>
  );
}
