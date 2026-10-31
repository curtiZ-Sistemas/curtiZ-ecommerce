"use client";
import React from "react";
import { ExternalLink } from "lucide-react";
export { LegalPolicyManager as LegalCenter } from "./legal-policy-manager";
export function OperationalLegalLinks() {
  const storeUrl = process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000";
  return (
    <section className="panel-card legal-operational" aria-labelledby="legal-operational-title">
      <h2 id="legal-operational-title">Centro público de políticas</h2>
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
        <ExternalLink aria-hidden="true" /> Abrir centro público
        <span className="sr-only"> (abre em nova aba)</span>
      </a>
    </section>
  );
}
