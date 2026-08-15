export default function Loading() {
  return (
    <main
      className="panel-loading"
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Carregando painel"
    >
      <span className="panel-loading-spinner" aria-hidden="true" />
      <span className="sr-only">Carregando painel…</span>
    </main>
  );
}
