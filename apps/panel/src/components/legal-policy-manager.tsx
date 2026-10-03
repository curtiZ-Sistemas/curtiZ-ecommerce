"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  legalPolicies,
  legalPlaceholders,
  legalCompanyProblems,
  legalCompanyReplacements,
  replaceLegalMarkers,
  legalSectionsFromText,
  legalSectionsToText,
  type LegalSection,
  type LegalSlug
} from "@curtiz/domain";
import type { LegalImportCandidate } from "@/lib/legal-import";
import { LegalContent } from "./legal-content";

const Advanced = dynamic(
  () => import("./legal-center-advanced").then((module) => module.AdvancedLegalCenter),
  { loading: () => <p role="status">Carregando ferramentas avançadas…</p> }
);
type Item = Record<string, unknown>;
type Snapshot = {
  documents: Item[];
  sections: Item[];
  company: Item | null;
  capabilities: Record<string, boolean>;
};
type Review = LegalImportCandidate & { id: number; saved?: boolean; result?: string };
type Editor = {
  slug: LegalSlug;
  title: string;
  source: string;
  etag: string | null;
  readOnly: boolean;
};
const value = (item: Item | undefined | null, key: string) =>
  typeof item?.[key] === "string" ? item[key] : "";
const rows = (input: unknown): Item[] =>
  Array.isArray(input)
    ? input.filter(
        (item): item is Item => !!item && typeof item === "object" && !Array.isArray(item)
      )
    : [];
const date = (input: string) =>
  input && Number.isFinite(Date.parse(input))
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo"
      }).format(new Date(input))
    : "";
function sectionsFor(snapshot: Snapshot, id: string): LegalSection[] {
  return snapshot.sections
    .filter((section) => section.document_id === id)
    .map((section) => ({
      section_number: value(section, "section_number"),
      title: value(section, "title"),
      content: value(section, "content"),
      content_format: section.content_format === "markdown" ? "markdown" : "plain",
      sort_order: typeof section.sort_order === "number" ? section.sort_order : 0
    }));
}
export function LegalPolicyManager() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [editor, setEditor] = useState<Editor>();
  const [advanced, setAdvanced] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [replacement, setReplacement] = useState<LegalSlug>();
  const [publicationResults, setPublicationResults] = useState<Item[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const nextReviewId = useRef(0);
  const locked = useRef(false);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/legal/policies", { cache: "no-store" });
    const payload = (await response.json()) as Item;
    if (!response.ok)
      throw new Error(value(payload, "message") || "Não foi possível carregar as políticas.");
    const state = {
      documents: rows(payload.documents),
      sections: rows(payload.sections),
      company:
        payload.company && typeof payload.company === "object" ? (payload.company as Item) : null,
      capabilities: (payload.capabilities as Record<string, boolean>) ?? {}
    };
    setSnapshot(state);
    return state;
  }, []);
  useEffect(() => {
    void load().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : "Falha ao carregar.")
    );
  }, [load]);
  useEffect(() => {
    if (editor) editorHeading.current?.focus();
  }, [editor?.slug, editor?.readOnly]);
  const canEdit = snapshot?.capabilities["legal_content.edit"] === true;
  const canPublish = snapshot?.capabilities["legal_content.publish"] === true;
  const replacements = legalCompanyReplacements(snapshot?.company ?? null);
  const companyProblems = legalCompanyProblems(snapshot?.company ?? null);
  const request = async (body: unknown) => {
    const response = await fetch("/api/legal/policies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = (await response.json()) as Item;
    if (!response.ok) throw new Error(value(data, "message") || "Operação não concluída.");
    return data;
  };
  const saveCandidate = async (candidate: Review, state: Snapshot) => {
    if (!candidate.slug) throw new Error("Escolha a política de destino.");
    const document = state.documents.find((item) => item.slug === candidate.slug);
    const policy = legalPolicies.find((item) => item.slug === candidate.slug)!;
    const response = await request({
      action: "import",
      slug: policy.slug,
      title: policy.title,
      sections: candidate.sections,
      expectedUpdatedAt: value(document, "updated_at") || null
    });
    const result = response.result as Item | undefined;
    return result?.unchanged ? "Conteúdo já salvo; nenhum registro duplicado." : "Minuta salva.";
  };
  const receive = async (files: File[], forcedSlug?: LegalSlug) => {
    if (!files.length || !snapshot || !canEdit || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    setEditor(undefined);
    setPublicationResults([]);
    try {
      const { importLegalFiles } = await import("@/lib/legal-import");
      const result = await importLegalFiles(files, forcedSlug);
      const items: Review[] = result.candidates.map((item) => ({
        ...item,
        id: ++nextReviewId.current
      }));
      setReviews(items);
      for (const item of items) {
        if (
          !item.slug ||
          item.warnings.length ||
          items.filter((other) => other.slug === item.slug).length > 1
        )
          continue;
        try {
          const saved = await saveCandidate(item, snapshot);
          item.saved = true;
          item.result = saved;
        } catch (reason) {
          item.result = reason instanceof Error ? reason.message : "Minuta não salva.";
        }
        setReviews([...items]);
      }
      if (result.errors.length) setError(result.errors.join("\n"));
      setMessage(
        `${items.length} documento(s) reconhecido(s).${result.ignored.length ? ` Guia, manifesto ou arquivos auxiliares ignorados: ${result.ignored.join(", ")}.` : ""}`
      );
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Importação não concluída.");
    } finally {
      locked.current = false;
      setBusy(false);
      setReplacement(undefined);
      if (input.current) input.current.value = "";
    }
  };
  const chooseCandidate = async (item: Review) => {
    if (!snapshot || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await saveCandidate(item, snapshot);
      setReviews((current) =>
        current
          .filter((other) => other.id === item.id || other.slug !== item.slug)
          .map((other) => (other.id === item.id ? { ...item, saved: true, result } : other))
      );
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Minuta não salva.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const openEditor = (slug: LegalSlug, readOnly: boolean) => {
    if (!snapshot) return;
    const document = snapshot.documents.find((item) => item.slug === slug);
    if (!document) return;
    setEditor({
      slug,
      title: value(document, "public_title"),
      source: legalSectionsToText(sectionsFor(snapshot, value(document, "id"))),
      etag: value(document, "updated_at"),
      readOnly
    });
    setMessage("");
  };
  const saveEditor = async () => {
    if (!editor || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const sections = legalSectionsFromText(editor.source, "markdown");
      await request({
        action: "import",
        slug: editor.slug,
        title: editor.title,
        sections,
        expectedUpdatedAt: editor.etag
      });
      await load();
      setEditor(undefined);
      setMessage("Minuta salva. A versão pública anterior permanece disponível até a publicação.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Minuta não salva.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const pendingFor = (document: Item) => [
    ...new Set(
      sectionsFor(snapshot!, value(document, "id")).flatMap((section) =>
        legalPlaceholders(`${section.title}\n${section.content}`)
      )
    )
  ];
  const ready = companyProblems.length
    ? []
    : (snapshot?.documents.filter(
        (document) =>
          legalPolicies.some((policy) => policy.slug === document.slug) &&
          !["published", "archived", "scheduled", "superseded"].includes(
            value(document, "status")
          ) &&
          !pendingFor(document).length &&
          !reviews.some((review) => review.slug === document.slug && !review.saved)
      ) ?? []);
  const publish = async (documents: Item[]) => {
    if (!documents.length || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await request({
        action: "publish",
        documents: documents.map((document) => ({
          id: document.id,
          updated_at: document.updated_at
        }))
      });
      setPublicationResults(rows(response.results));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Publicação não concluída.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const saveCompany = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const body = {
        kind: "company",
        ...Object.fromEntries(
          [
            "legalName",
            "tradeName",
            "taxId",
            "address",
            "email",
            "phone",
            "privacyChannel",
            "dataProtectionContact",
            "supportChannel"
          ].map((key) => {
            const text = form.get(key);
            return [key, typeof text === "string" ? text : ""];
          })
        ),
        completenessStatus: form.get("confirmed") === "on" ? "complete" : "review"
      };
      const response = await fetch("/api/legal", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error("Revise os dados empresariais e tente novamente.");
      await load();
      setMessage(
        "Dados salvos. Abra cada minuta e confira a prévia das substituições antes de aplicá-las."
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Dados não salvos.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  if (!snapshot)
    return (
      <section className="panel-card" aria-live="polite">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              className="secondary-button"
              onClick={() => {
                setError("");
                void load().catch((reason: unknown) =>
                  setError(reason instanceof Error ? reason.message : "Falha ao carregar.")
                );
              }}
            >
              Tentar novamente
            </button>
          </>
        ) : (
          <p>Carregando políticas…</p>
        )}
      </section>
    );
  const preview = editor ? legalSectionsFromText(editor.source, "markdown") : [];
  const commonFields = [
    ["legalName", "Razão social", "legal_name"],
    ["tradeName", "Nome fantasia", "trade_name"],
    ["taxId", "CNPJ", "tax_id"],
    ["address", "Endereço empresarial completo", "address"],
    ["email", "E-mail de atendimento", "email"],
    ["phone", "Telefone", "phone"],
    ["privacyChannel", "Canal de privacidade", "privacy_channel"],
    ["dataProtectionContact", "Responsável pelo canal de privacidade", "data_protection_contact"],
    ["supportChannel", "Canal de atendimento", "support_channel"]
  ] as const;
  return (
    <div className="legal-center legal-policy-manager">
      <section
        className={`panel-card legal-dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (canEdit && !busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void receive(Array.from(event.dataTransfer.files));
        }}
      >
        <h2>Arraste suas políticas aqui</h2>
        <p>Selecione o pacote ou os documentos. O destino é reconhecido automaticamente.</p>
        <input
          ref={input}
          type="file"
          multiple
          accept=".docx,.txt,.html,.htm,.md,.zip,.json"
          hidden
          onChange={(event) => {
            void receive(Array.from(event.target.files ?? []), replacement);
          }}
        />
        <button
          className="primary-button"
          disabled={!canEdit || busy}
          onClick={() => {
            setReplacement(undefined);
            input.current?.click();
          }}
        >
          Selecionar arquivos
        </button>
        <small>
          DOCX, TXT, HTML, Markdown, ZIP e Mapa_de_Publicacao.json. Até 40 arquivos, 8 MB por
          arquivo e 24 MB no total.
        </small>
        {!canEdit && (
          <p>Seu acesso permite consultar as políticas. A importação exige permissão de edição.</p>
        )}
      </section>
      {busy && <p role="status">Processando. Aguarde…</p>}
      {error && (
        <p role="alert" className="legal-feedback error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="legal-feedback">
          {message}
        </p>
      )}
      {reviews.length > 0 && (
        <section className="panel-card legal-import-review">
          <h3>Conferência da importação</h3>
          {reviews.map((item) => (
            <div key={item.id} className="legal-import-item">
              <strong>{item.name}</strong>
              <label>
                Política reconhecida
                <select
                  aria-label={`Destino de ${item.name}`}
                  disabled={busy || item.saved}
                  value={item.slug ?? ""}
                  onChange={(event) =>
                    setReviews((current) =>
                      current.map((review) =>
                        review.id === item.id
                          ? { ...review, slug: (event.target.value as LegalSlug) || undefined }
                          : review
                      )
                    )
                  }
                >
                  <option value="">Escolha uma política</option>
                  {legalPolicies.map((policy) => (
                    <option key={policy.slug} value={policy.slug}>
                      {policy.title}
                    </option>
                  ))}
                </select>
              </label>
              <span>Destino: {item.slug ? `/politicas/${item.slug}` : "A confirmar"}</span>
              {item.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
              {reviews.filter((other) => other.slug && other.slug === item.slug).length > 1 && (
                <p>Há versões com diferenças reais. Confira o conteúdo e escolha qual salvar.</p>
              )}
              <details>
                <summary>Conferir conteúdo e pendências</summary>
                <p>
                  {legalPlaceholders(
                    item.sections.map((section) => section.content).join("\n")
                  ).join(", ") || "Sem campos pendentes no texto."}
                </p>
                {item.sections.map((section) => (
                  <section key={section.section_number}>
                    <h4>
                      {section.section_number !== "0" ? `${section.section_number} ` : ""}
                      {section.title}
                    </h4>
                    <LegalContent content={section.content} format={section.content_format} />
                  </section>
                ))}
              </details>
              {item.result && <p role="status">{item.result}</p>}
              {!item.saved && (
                <button
                  className="secondary-button"
                  disabled={busy || !item.slug}
                  onClick={() => void chooseCandidate(item)}
                >
                  Usar esta versão e salvar minuta
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      <section className="panel-card legal-policy-list">
        <div className="legal-list-heading">
          <h3>Políticas da loja</h3>
          <button
            className="primary-button"
            disabled={busy || !canPublish || !ready.length || Boolean(editor && !editor.readOnly)}
            onClick={() => void publish(ready)}
          >
            Publicar políticas prontas{ready.length ? ` (${ready.length})` : ""}
          </button>
        </div>
        <p>
          A publicação registra a aprovação do responsável sobre esta versão. A revisão jurídica
          permanece uma ação independente.
        </p>
        {!canPublish && (
          <p>
            Você pode preparar as minutas. A publicação exige um responsável com permissão para
            publicar.
          </p>
        )}
        {companyProblems.length > 0 && (
          <p>Antes de publicar, complete os dados da empresa: {companyProblems.join("; ")}.</p>
        )}
        {legalPolicies.map((policy) => {
          const document = snapshot.documents.find((item) => item.slug === policy.slug);
          const placeholders = document ? pendingFor(document) : [];
          const unresolved = reviews.some((review) => review.slug === policy.slug && !review.saved);
          return (
            <div className="legal-policy-row" key={policy.slug}>
              <div>
                <strong>{policy.title}</strong>
                <span>
                  {!document
                    ? "Não cadastrada"
                    : unresolved ||
                        placeholders.length ||
                        (companyProblems.length && document.status !== "published")
                      ? "Pendências"
                      : document.status === "published"
                        ? "Publicada"
                        : "Minuta"}
                </span>
                {value(document, "last_published_at") && (
                  <small>Última publicação: {date(value(document, "last_published_at"))}</small>
                )}
                {placeholders.length > 0 && (
                  <p className="legal-pending-markers">Preencher: {placeholders.join(", ")}</p>
                )}
              </div>
              <div className="legal-row-actions">
                <button
                  className="secondary-button"
                  disabled={busy || !document}
                  onClick={() => openEditor(policy.slug, true)}
                >
                  Visualizar
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || !canEdit || !document}
                  onClick={() => openEditor(policy.slug, false)}
                >
                  Editar
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || !canEdit}
                  onClick={() => {
                    setReplacement(policy.slug);
                    input.current?.click();
                  }}
                >
                  Substituir arquivo
                </button>
                {document && value(document, "last_published_at") && (
                  <a
                    className="secondary-button"
                    href={`${process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000"}/politicas/${policy.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Ver no site
                  </a>
                )}
                <button
                  className="primary-button"
                  disabled={
                    busy ||
                    !canPublish ||
                    !document ||
                    !ready.includes(document) ||
                    Boolean(editor && !editor.readOnly)
                  }
                  onClick={() => document && void publish([document])}
                >
                  Publicar
                </button>
              </div>
            </div>
          );
        })}
        {publicationResults.length > 0 && (
          <div aria-live="polite">
            {publicationResults.map((result) => (
              <p key={value(result, "id")}>
                {value(
                  snapshot.documents.find((document) => document.id === result.id),
                  "public_title"
                )}
                :{" "}
                {result.published
                  ? result.unchanged
                    ? "Já publicada; nenhuma versão duplicada."
                    : "Publicada com sucesso."
                  : Array.isArray(result.problems)
                    ? result.problems.join("; ")
                    : "Não publicada."}
              </p>
            ))}
          </div>
        )}
      </section>
      {editor && (
        <section className="panel-card legal-simple-editor">
          <h3 ref={editorHeading} tabIndex={-1}>
            {editor.readOnly ? "Visualizar minuta" : "Editar minuta"}: {editor.title}
          </h3>
          <p>/politicas/{editor.slug}</p>
          {!editor.readOnly && (
            <>
              <label>
                Texto completo
                <textarea
                  rows={20}
                  value={editor.source}
                  onChange={(event) => setEditor({ ...editor, source: event.target.value })}
                  disabled={busy}
                />
              </label>
              <small>
                Use **texto** para destaque, *texto* para ênfase, “## 1 Título” para seções e “-
                item” para listas.
              </small>
              {Object.keys(replacements).some((marker) => editor.source.includes(marker)) && (
                <details>
                  <summary>Prévia dos dados empresariais conferidos</summary>
                  <dl>
                    {Object.entries(replacements)
                      .filter(([marker]) => editor.source.includes(marker))
                      .map(([marker, text]) => (
                        <div key={marker}>
                          <dt>{marker}</dt>
                          <dd>{text}</dd>
                        </div>
                      ))}
                  </dl>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      setEditor({
                        ...editor,
                        source: legalSectionsToText(replaceLegalMarkers(preview, replacements))
                      })
                    }
                  >
                    Aplicar dados conferidos à minuta
                  </button>
                </details>
              )}
              <p>Campos pendentes: {legalPlaceholders(editor.source).join(", ") || "nenhum"}.</p>
              <button className="primary-button" disabled={busy} onClick={() => void saveEditor()}>
                Salvar minuta
              </button>
            </>
          )}
          <button className="secondary-button" disabled={busy} onClick={() => setEditor(undefined)}>
            Fechar {editor.readOnly ? "prévia" : "editor sem salvar"}
          </button>
          <article className="legal-preview">
            <h4>Prévia</h4>
            {preview.map((section) => (
              <section key={section.section_number}>
                <h4>
                  {section.section_number !== "0" ? `${section.section_number} ` : ""}
                  {section.title}
                </h4>
                <LegalContent content={section.content} format={section.content_format} />
              </section>
            ))}
          </article>
        </section>
      )}
      <details className="panel-card legal-company-details">
        <summary>Dados da empresa — preencher uma vez</summary>
        <p>
          Use somente dados confirmados. Confira as substituições na prévia de cada minuta;
          condições específicas continuam junto à política.
        </p>
        <form
          key={value(snapshot.company, "updated_at")}
          onSubmit={(event) => void saveCompany(event)}
        >
          <div className="legal-form-grid">
            {commonFields.map(([key, label, column]) => (
              <label key={key}>
                {label}
                <input
                  name={key}
                  type={key === "email" ? "email" : "text"}
                  defaultValue={value(snapshot.company, column)}
                  disabled={!canEdit || busy}
                />
              </label>
            ))}
          </div>
          <label className="legal-company-confirm">
            <input
              type="checkbox"
              name="confirmed"
              defaultChecked={snapshot.company?.completeness_status === "complete"}
              disabled={!canEdit || busy}
            />
            Conferi os dados empresariais
          </label>
          <button className="primary-button" disabled={!canEdit || busy}>
            Salvar dados empresariais
          </button>
        </form>
      </details>
      <details
        className="panel-card"
        onToggle={(event) => {
          if (event.currentTarget.open) setAdvanced(true);
        }}
      >
        <summary>Outros documentos e ferramentas avançadas</summary>
        <p>
          Histórico, auditoria, revisão jurídica, referências, cookies, aceites e solicitações de
          privacidade.
        </p>
        {advanced && <Advanced />}
      </details>
    </div>
  );
}
