"use client";

import { LifeBuoy, RefreshCcw } from "lucide-react";
import Link from "next/link";
import { ErrorPageShell } from "../components/error-page-shell";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <ErrorPageShell
      code="Erro inesperado"
      eyebrow="Não foi possível carregar"
      title="Algo não saiu como esperado."
      description="Não foi possível abrir esta página agora. Você pode tentar novamente ou seguir por um caminho seguro."
      actions={
        <>
          <button className="primary-button" type="button" onClick={reset}>
            <RefreshCcw aria-hidden="true" /> Tentar novamente
          </button>
          <Link className="secondary-button" href="/">
            Ir ao início
          </Link>
          <Link className="text-link error-help-link" href="/ajuda">
            <LifeBuoy aria-hidden="true" /> Acessar ajuda
          </Link>
        </>
      }
    />
  );
}
