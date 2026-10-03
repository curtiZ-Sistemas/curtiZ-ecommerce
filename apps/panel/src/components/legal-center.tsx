"use client";
import React from "react";
import { BookOpenCheck, ExternalLink } from "lucide-react";
export { LegalPolicyManager as LegalCenter } from "./legal-policy-manager";
export function OperationalLegalLinks() {
  const storeUrl = process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000";
  return (
    <section className="panel-card legal-operational">
      <BookOpenCheck />
      <div>
        <h2>Políticas oficiais</h2>
        <p>
          O perfil Operacional pode consultar e compartilhar somente documentos publicados e
          vigentes.
        </p>
        <a
          className="primary-button"
          href={`${storeUrl}/politicas`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink /> Abrir centro público
        </a>
      </div>
    </section>
  );
}
