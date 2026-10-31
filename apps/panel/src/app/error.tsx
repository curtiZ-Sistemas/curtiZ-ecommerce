"use client";

import { RefreshCw } from "lucide-react";

export default function PanelError({ reset }: { reset: () => void }) {
  return (
    <main className="panel-fallback">
      <section className="panel-fallback-sheet" role="alert" aria-labelledby="panel-error-title">
        <p>Falha ao carregar</p>
        <h1 id="panel-error-title">Não foi possível abrir esta área do painel.</h1>
        <p>Tente carregar a área de novo. Se o erro continuar, avise o suporte técnico.</p>
        <div className="panel-fallback-actions">
          <button className="primary-button" type="button" onClick={reset}>
            <RefreshCw aria-hidden="true" /> Tentar novamente
          </button>
        </div>
      </section>
    </main>
  );
}
