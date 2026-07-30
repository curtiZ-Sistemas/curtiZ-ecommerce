"use client";

export default function PanelError({ reset }: { reset: () => void }) {
  return (
    <main className="panel-status-page">
      <p>Falha ao carregar</p>
      <h1>Não foi possível abrir esta área do painel.</h1>
      <button type="button" onClick={reset}>
        Tentar novamente
      </button>
    </main>
  );
}
