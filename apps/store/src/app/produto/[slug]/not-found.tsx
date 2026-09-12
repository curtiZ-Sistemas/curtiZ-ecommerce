import { ArrowLeft, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { ErrorRecommendations } from "@/components/error-recommendations";
import styles from "./not-found.module.css";

export default function ProductNotFound() {
  return (
    <div className={`container page-shell ${styles.page}`}>
      <section className={styles.recovery} aria-labelledby="product-not-found-title">
        <p className="eyebrow">Catálogo curti Z</p>
        <h1 id="product-not-found-title">Este produto não está mais disponível</h1>
        <p className={styles.description}>
          O produto que você procurou saiu do nosso catálogo. Confira outros modelos que podem
          combinar com você.
        </p>
        <div className={`error-actions ${styles.actions}`}>
          <Link className="primary-button" href="/produtos">
            <ShoppingBag aria-hidden="true" /> Ver produtos
          </Link>
          <Link className="secondary-button" href="/">
            <ArrowLeft aria-hidden="true" /> Voltar para a loja
          </Link>
        </div>
      </section>
      <ErrorRecommendations />
    </div>
  );
}
