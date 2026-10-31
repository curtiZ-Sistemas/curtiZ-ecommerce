import Link from "next/link";

export default function PanelNotFound() {
  return (
    <main className="panel-fallback">
      <section className="panel-fallback-sheet" aria-labelledby="panel-not-found-title">
        <p>404</p>
        <h1 id="panel-not-found-title">Página não encontrada</h1>
        <p>Esta área não existe ou não está disponível para o seu perfil.</p>
        <div className="panel-fallback-actions">
          <Link className="primary-button" href="/">
            Voltar ao acesso
          </Link>
        </div>
      </section>
    </main>
  );
}
