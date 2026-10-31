import { ChevronRight } from "lucide-react";
import Link from "next/link";

// O cabeçalho da rota (shell) já mostra o título "Aprovações" e a descrição da página.
const queues = [
  {
    href: "/gerencia/solicitacoes-representantes",
    title: "Solicitações de representantes",
    consequence: "Documentos, análise e decisão justificada"
  },
  {
    href: "/gerencia/conteudo-loja",
    title: "Conteúdo da loja",
    consequence: "Publicação, agenda e restauração de versões"
  },
  {
    href: "/gerencia/criativos",
    title: "Criativos",
    consequence: "Aprovação simples ou dupla conforme a campanha"
  },
  {
    href: "/gerencia/campanhas",
    title: "Campanhas",
    consequence: "Agenda e estados persistidos de publicação"
  },
  {
    href: "/gerencia/fechamentos",
    title: "Fechamentos de comissão",
    consequence: "Aprovar, bloquear ou reabrir com auditoria"
  }
];

export function ManagerApprovals() {
  return (
    <section className="manager-approvals" aria-labelledby="manager-approvals-title">
      <h2 id="manager-approvals-title" className="sr-only">Central de aprovações</h2>
      <p className="manager-approvals-note">As decisões permanecem nos fluxos de origem e são validadas no servidor.</p>
      <ul className="manager-approval-list">
        {queues.map((queue) => (
          <li key={queue.href}>
            <Link className="manager-approval-link" href={queue.href}>
              <span className="manager-approval-text">
                <strong>{queue.title}</strong>
                <small>{queue.consequence}</small>
              </span>
              <span className="manager-approval-action" aria-hidden="true">
                Abrir fila <ChevronRight />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
