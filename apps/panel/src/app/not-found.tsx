import Link from "next/link";

export default function PanelNotFound() {
  return (
    <main className="panel-status-page">
      <p>Página não encontrada</p>
      <h1>Esta área não existe ou não está disponível para o perfil atual.</h1>
      <Link href="/">Voltar ao acesso</Link>
    </main>
  );
}
