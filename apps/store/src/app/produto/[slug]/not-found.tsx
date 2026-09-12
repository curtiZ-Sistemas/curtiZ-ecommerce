import { ArrowLeft, Search, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { ErrorRecommendations } from "@/components/error-recommendations";
import styles from "./not-found.module.css";

export default function ProductNotFound() {
  return (
    <div className={`container page-shell ${styles.page}`}>
      <section className={styles.recovery} aria-labelledby="product-not-found-title">
        <p className="eyebrow">Catálogo curti Z</p>
        <h1 id="product-not-found-title">Este modelo não está mais disponível</h1>
        <p className={styles.description}>
          Este item saiu do catálogo ou teve a página atualizada. Você pode continuar navegando
          pelos modelos disponíveis ou buscar algo parecido.
        </p>
        <div className={`error-actions ${styles.actions}`}>
          <Link className="primary-button" href="/produtos">
            <ShoppingBag aria-hidden="true" /> Ver produtos
          </Link>
          <Link className="secondary-button" href="/busca">
            <Search aria-hidden="true" /> Buscar na loja
          </Link>
          <Link className={styles.backLink} href="/">
            <ArrowLeft aria-hidden="true" /> Voltar ao início
          </Link>
        </div>
      </section>
      <ErrorRecommendations title="Outros modelos para você" />
    </div>
  );
}
