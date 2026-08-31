import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, ExternalLink } from "lucide-react";
import { BRAND_NAME, officialUrl } from "@/lib/seo";
import { getPublicLegalDocument } from "@/lib/legal-data";

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const document = await getPublicLegalDocument((await params).slug);
  if (!document) {
    return {
      title: "Documento não publicado",
      robots: { index: false, follow: false, noarchive: true }
    };
  }

  const path = `/politicas/${encodeURIComponent(document.slug)}`;
  return {
    title: document.title,
    description: document.summary,
    alternates: { canonical: officialUrl(path) },
    openGraph: {
      type: "article",
      siteName: BRAND_NAME,
      locale: "pt_BR",
      title: `${document.title} | ${BRAND_NAME}`,
      description: document.summary,
      url: officialUrl(path)
    }
  };
}

export default async function LegalDocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const document = await getPublicLegalDocument((await params).slug);
  if (!document)
    return (
      <div className="container legal-public-page">
        <section className="legal-public-empty">
          <AlertCircle />
          <h1>Documento ainda não publicado</h1>
          <p>
            Esta rota não expõe minutas, placeholders ou versões sem aprovação. Consulte o centro
            público para ver os documentos vigentes.
          </p>
          <Link className="primary-button" href="/politicas">
            Ver documentos publicados
          </Link>
        </section>
      </div>
    );
  const format = (value: string) =>
    new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" }).format(
      new Date(value)
    );
  return (
    <article className="container legal-document-page">
      <header>
        <Link href="/politicas">← Políticas</Link>
        <span className="eyebrow">Documento oficial vigente</span>
        <h1>{document.title}</h1>
        <p>{document.summary}</p>
        <dl>
          <div>
            <dt>Versão</dt>
            <dd>{document.version}</dd>
          </div>
          <div>
            <dt>Publicação</dt>
            <dd>{format(document.publishedAt)}</dd>
          </div>
          <div>
            <dt>Vigência</dt>
            <dd>{format(document.effectiveFrom)}</dd>
          </div>
          <div>
            <dt>Última revisão</dt>
            <dd>{format(document.publishedAt)}</dd>
          </div>
        </dl>
      </header>
      <div className="legal-document-layout">
        <nav aria-label="Índice do documento">
          <strong>Índice</strong>
          {document.sections.map((section) => (
            <a href={`#secao-${section.number}`} key={section.number}>
              {section.number} {section.title}
            </a>
          ))}
        </nav>
        <div className="legal-document-content">
          {document.sections.map((section) => (
            <section id={`secao-${section.number}`} key={section.number}>
              <h2>
                {section.number} {section.title}
              </h2>
              {section.content
                .split(/\n+/u)
                .filter(Boolean)
                .map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
            </section>
          ))}
          {document.company.privacy_channel && (
            <section>
              <h2>Contato</h2>
              <p>{document.company.privacy_channel}</p>
            </section>
          )}
          {document.references.length > 0 && (
            <section>
              <h2>Referências</h2>
              <ol>
                {document.references.map((reference) => (
                  <li key={reference.officialUrl}>
                    <a href={reference.officialUrl} target="_blank" rel="noreferrer">
                      {reference.name} <ExternalLink aria-hidden="true" />
                    </a>
                    {reference.relatedArticle ? ` — ${reference.relatedArticle}` : ""}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </article>
  );
}
