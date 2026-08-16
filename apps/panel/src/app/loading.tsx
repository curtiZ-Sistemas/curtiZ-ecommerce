export default function Loading() {
  return (
    <main
      className="panel-loading-shell"
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Carregando painel"
    >
      <aside className="panel-loading-sidebar" aria-hidden="true">
        <span className="panel-skeleton panel-loading-logo" />
        <span className="panel-skeleton panel-loading-nav-wide" />
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <span className="panel-skeleton panel-loading-nav" key={item} />
        ))}
      </aside>
      <section className="panel-loading-workspace" aria-hidden="true">
        <header className="panel-loading-topbar">
          <span className="panel-skeleton panel-loading-breadcrumb" />
          <span className="panel-skeleton panel-loading-account" />
        </header>
        <div className="panel-loading-content">
          <div className="panel-loading-title-row">
            <div>
              <span className="panel-skeleton panel-loading-title" />
              <span className="panel-skeleton panel-loading-description" />
            </div>
            <span className="panel-skeleton panel-loading-action" />
          </div>
          <div className="panel-loading-metrics">
            {[0, 1, 2, 3].map((item) => (
              <span className="panel-skeleton panel-loading-metric" key={item} />
            ))}
          </div>
          <span className="panel-skeleton panel-loading-table" />
        </div>
      </section>
      <span className="sr-only">Carregando painel…</span>
    </main>
  );
}
