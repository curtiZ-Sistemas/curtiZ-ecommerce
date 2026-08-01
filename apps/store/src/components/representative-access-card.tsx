import Link from "next/link";
import React from "react";

export function RepresentativeAccessCard({ active }: { active: boolean }) {
  return (
    <article className="representative-account-card">
      <div>
        <p className="eyebrow">Representante Curtiz</p>
        <h2>{active ? "Área profissional ativa" : "Solicite sua participação"}</h2>
        <p>
          {active
            ? "Alterne para seu portal sem perder o acesso de cliente."
            : "O processo tem seis etapas, rascunho seguro e análise humana."}
        </p>
      </div>
      <Link
        className="primary-button"
        href={active ? "/representante" : "/representante/solicitacao"}
      >
        {active ? "Ir ao portal" : "Iniciar solicitação"}
      </Link>
    </article>
  );
}
