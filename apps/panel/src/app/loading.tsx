export default function Loading() {
  return (
    <main className="panel-loading" aria-busy="true" aria-label="Carregando painel">
      <div className="panel-loading-heading" />
      <div className="panel-loading-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="panel-loading-card" key={index} />
        ))}
      </div>
      <div className="panel-loading-table" />
    </main>
  );
}

