import type { Metadata } from "next";
import Link from "next/link";
import { BookOpenCheck, FileCheck2 } from "lucide-react";
import { getPublicLegalDocuments } from "@/lib/legal-data";
import { catalogMetadata } from "@/lib/catalog-metadata";

export const metadata: Metadata = catalogMetadata({
  title: "Políticas e documentos legais",
  description: "Consulte os documentos oficiais publicados e vigentes da curti Z.",
  path: "/politicas"
});

export default async function PoliciesPage() {
  const documents = await getPublicLegalDocuments();
  return (
    <div className="container legal-public-page">
      <header className="legal-public-header">
        <span className="eyebrow">Transparência</span>
        <h1>Políticas e documentos legais</h1>
        <p>
          Consulte somente versões publicadas e vigentes. Minutas em revisão nunca são exibidas
          aqui.
        </p>
      </header>
      {documents.length ? (
        <div className="legal-public-grid">
          {documents.map((document) => (
            <Link href={`/politicas/${document.slug}`} key={document.id}>
              <FileCheck2 />
              <span>
                <strong>{document.title}</strong>
                <small>{document.summary}</small>
                <em>
                  Versão {document.version} · vigência{" "}
                  {new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(
                    new Date(document.effectiveFrom)
                  )}
                </em>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <section className="legal-public-empty">
          <BookOpenCheck />
          <h2>Documentos em revisão</h2>
          <p>
            Nenhuma minuta foi publicada automaticamente. Os documentos aparecerão após revisão
            jurídica, aprovação gerencial e configuração dos dados empresariais.
          </p>
        </section>
      )}
      <aside className="legal-public-privacy">
        <h2>Privacidade</h2>
        <p>
          Você pode registrar uma solicitação sobre seus dados pessoais sem depender da publicação
          das minutas.
        </p>
        <Link className="secondary-button" href="/privacidade/solicitacoes">
          Fazer uma solicitação
        </Link>
      </aside>
    </div>
  );
}
