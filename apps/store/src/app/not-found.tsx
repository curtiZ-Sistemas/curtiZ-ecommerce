import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container page-shell status-page">
      <div className="empty-state">
        <SearchX aria-hidden="true" />
        <p className="eyebrow">Página não encontrada</p>
        <h1>Não encontramos este endereço</h1>
        <p>O conteúdo pode ter mudado ou o link pode estar incompleto.</p>
        <div className="status-page-actions">
          <Link className="primary-button" href="/produtos">
            Ver produtos
          </Link>
          <Link className="secondary-button" href="/">
            <ArrowLeft aria-hidden="true" /> Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}
