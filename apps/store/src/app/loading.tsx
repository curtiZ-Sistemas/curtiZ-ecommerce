export default function Loading() {
  return (
    <div
      className="page-loading-state"
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Carregando página"
    >
      <span className="page-loading-spinner" aria-hidden="true" />
      <span className="sr-only">Carregando página…</span>
    </div>
  );
}
