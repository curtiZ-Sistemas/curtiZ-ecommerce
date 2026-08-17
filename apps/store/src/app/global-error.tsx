"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body>
        <main className="global-error-page">
          <section className="global-error-card" aria-labelledby="global-error-title">
            <a className="global-error-brand" href="/" aria-label="curti Z — página inicial">
              curti Z
            </a>
            <span className="error-code">Erro inesperado</span>
            <p className="eyebrow">Serviço temporariamente indisponível</p>
            <h1 id="global-error-title">Não foi possível carregar a loja agora.</h1>
            <p>
              Tente novamente. Se o problema continuar, você ainda pode acessar nossa central de
              ajuda.
            </p>
            <div className="error-actions">
              <button className="primary-button" type="button" onClick={reset}>
                Tentar novamente
              </button>
              <a className="secondary-button" href="/">
                Ir para o início
              </a>
              <a className="text-link error-help-link" href="/ajuda">
                Acessar ajuda
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
