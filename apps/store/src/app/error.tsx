"use client";

import { RefreshCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="container page-shell status-page">
      <div className="empty-state">
        <TriangleAlert aria-hidden="true" />
        <p className="eyebrow">Não foi possível carregar</p>
        <h1>Algo interrompeu esta página</h1>
        <p>Tente novamente. Seu carrinho e os dados já preenchidos foram preservados.</p>
        <div className="status-page-actions">
          <button className="primary-button" type="button" onClick={reset}>
            <RefreshCcw aria-hidden="true" /> Tentar novamente
          </button>
          <Link className="secondary-button" href="/">
            Ir ao início
          </Link>
        </div>
      </div>
    </div>
  );
}
