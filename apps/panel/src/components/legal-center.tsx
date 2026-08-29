"use client";

import React, { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  BookOpenCheck,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileClock,
  FileText,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Save,
  Send,
  ShieldCheck
} from "lucide-react";
import { usePanelPrompt } from "./panel-prompt";

type Item = Record<string, unknown>;
type Capability =
  | "legal_content.create"
  | "legal_content.edit"
  | "legal_content.review"
  | "legal_content.publish"
  | "legal_content.archive"
  | "legal_acceptance.view"
  | "privacy_request.manage"
  | "cookie_settings.manage";
type SectionDraft = { section_number: string; title: string; content: string; sort_order: number };
type DocumentDraft = {
  internal_name: string;
  public_title: string;
  slug: string;
  summary: string;
  document_type: string;
  language: string;
  audience: string;
  requires_acceptance: boolean;
  requires_new_acceptance: boolean;
  display_locations: string[];
  reference_ids: string[];
  change_summary: string;
  internal_notes: string;
};
type Snapshot = {
  documents: Item[];
  sections: Item[];
  versions: Item[];
  reviews: Item[];
  references: Item[];
  referenceLinks: Item[];
  company: Item | null;
  categories: Item[];
  cookies: Item[];
  requests: Item[];
  events: Item[];
  acceptances: Item[];
  capabilities: Partial<Record<Capability, boolean>>;
};

const emptyDraft: DocumentDraft = {
  internal_name: "",
  public_title: "",
  slug: "",
  summary: "",
  document_type: "policy",
  language: "pt-BR",
  audience: "public",
  requires_acceptance: false,
  requires_new_acceptance: false,
  display_locations: [],
  reference_ids: [],
  change_summary: "",
  internal_notes: "MINUTA: exige revisão jurídica antes da publicação."
};
const emptySection: SectionDraft = {
  section_number: "1",
  title: "Objetivo",
  content: "",
  sort_order: 1
};
const tabs = [
  "visao-geral",
  "documentos",
  "empresa",
  "cookies",
  "aceites",
  "solicitacoes",
  "referencias",
  "auditoria"
] as const;
type Tab = (typeof tabs)[number];

function text(item: Item | null | undefined, key: string) {
  return typeof item?.[key] === "string" ? item[key] : "";
}
function bool(item: Item | null | undefined, key: string) {
  return item?.[key] === true;
}
function numberValue(item: Item | null | undefined, key: string) {
  return typeof item?.[key] === "number" ? item[key] : 0;
}
function date(value: unknown) {
  return typeof value === "string" && value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo"
      }).format(new Date(value))
    : "—";
}
function statusLabel(status: string) {
  return (
    (
      {
        draft: "Rascunho",
        under_review: "Em revisão",
        changes_requested: "Ajustes solicitados",
        legally_reviewed: "Revisado juridicamente",
        approved: "Aprovado",
        scheduled: "Agendado",
        published: "Publicado",
        superseded: "Substituído",
        archived: "Arquivado"
      } as Record<string, string>
    )[status] ?? status
  );
}
function recordArray(value: unknown): Item[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Item =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
      )
    : [];
}
function formText(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}
function snapshotText(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Snapshot indisponível para comparação.";
  }
}

export function LegalCenter() {
  const requestPrompt = usePanelPrompt();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [tab, setTab] = useState<Tab>("visao-geral");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<DocumentDraft>(emptyDraft);
  const [sections, setSections] = useState<SectionDraft[]>([emptySection]);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/legal", { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload))
        throw new Error("Não foi possível carregar o centro jurídico.");
      const data = payload as Record<string, unknown>;
      setSnapshot({
        documents: recordArray(data.documents),
        sections: recordArray(data.sections),
        versions: recordArray(data.versions),
        reviews: recordArray(data.reviews),
        references: recordArray(data.references),
        referenceLinks: recordArray(data.referenceLinks),
        company:
          data.company && typeof data.company === "object" && !Array.isArray(data.company)
            ? (data.company as Item)
            : null,
        categories: recordArray(data.categories),
        cookies: recordArray(data.cookies),
        requests: recordArray(data.requests),
        events: recordArray(data.events),
        acceptances: recordArray(data.acceptances),
        capabilities:
          data.capabilities &&
          typeof data.capabilities === "object" &&
          !Array.isArray(data.capabilities)
            ? data.capabilities
            : {}
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar o centro jurídico."
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  const selected = snapshot?.documents.find((item) => text(item, "id") === selectedId);
  const selectedVersions = useMemo(
    () => snapshot?.versions.filter((item) => text(item, "document_id") === selectedId) ?? [],
    [snapshot, selectedId]
  );

  const edit = (document: Item) => {
    setCreating(false);
    setSelectedId(text(document, "id"));
    setTab("documentos");
    setDraft({
      internal_name: text(document, "internal_name"),
      public_title: text(document, "public_title"),
      slug: text(document, "slug"),
      summary: text(document, "summary"),
      document_type: text(document, "document_type"),
      language: text(document, "language") || "pt-BR",
      audience: text(document, "audience") || "public",
      requires_acceptance: bool(document, "requires_acceptance"),
      requires_new_acceptance: bool(document, "requires_new_acceptance"),
      display_locations: Array.isArray(document.display_locations)
        ? document.display_locations.filter((entry): entry is string => typeof entry === "string")
        : [],
      reference_ids:
        snapshot?.referenceLinks
          .filter((link) => text(link, "document_id") === text(document, "id"))
          .map((link) => text(link, "reference_id")) ?? [],
      change_summary: text(document, "change_summary"),
      internal_notes: text(document, "internal_notes")
    });
    const related =
      snapshot?.sections
        .filter((item) => text(item, "document_id") === text(document, "id"))
        .map((item) => ({
          section_number: text(item, "section_number"),
          title: text(item, "title"),
          content: text(item, "content"),
          sort_order: numberValue(item, "sort_order")
        })) ?? [];
    setSections(related.length ? related : [emptySection]);
  };

  const request = async (method: "POST" | "PATCH", body: unknown, action: string) => {
    setPending(action);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/legal", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload: unknown = await response.json();
      const result =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {};
      if (!response.ok)
        throw new Error(
          typeof result.message === "string" ? result.message : "Operação não concluída."
        );
      setMessage(typeof result.message === "string" ? result.message : "Alteração registrada.");
      await load();
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Operação não concluída.");
      return false;
    } finally {
      setPending("");
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const body = {
      kind: "document",
      ...(creating ? {} : { id: selectedId }),
      document: draft,
      sections
    };
    const saved = await request(creating ? "POST" : "PATCH", body, "save");
    if (saved && creating) {
      setCreating(false);
      setDraft(emptyDraft);
      setSections([emptySection]);
    }
  };

  const transition = async (action: string) => {
    if (!selectedId) return;
    const reason = (await requestPrompt({
      title: "Atualizar documento legal",
      label: "Motivo auditável desta decisão",
      minLength: 3
    }))?.trim();
    if (!reason) return;
    let effectiveFrom: string | null = null;
    if (["publish", "schedule"].includes(action)) {
      const input = await requestPrompt({
        title: "Definir vigência",
        label: "Data e hora de vigência",
        defaultValue: new Date().toISOString().slice(0, 16),
        multiline: false,
        inputType: "datetime-local"
      });
      if (!input) return;
      const parsed = new Date(input);
      if (Number.isNaN(parsed.getTime())) {
        setError("Data de vigência inválida.");
        return;
      }
      effectiveFrom = parsed.toISOString();
    }
    await request(
      "PATCH",
      { kind: "transition", id: selectedId, action, reason, effectiveFrom },
      action
    );
  };

  const duplicate = async () => {
    if (!selected) return;
    const suffix = Date.now().toString().slice(-6);
    await request(
      "POST",
      {
        kind: "document",
        document: {
          ...draft,
          internal_name: `${draft.internal_name} — cópia`,
          public_title: `${draft.public_title} — cópia`,
          slug: `${draft.slug}-copia-${suffix}`,
          change_summary: "Minuta duplicada para nova revisão."
        },
        sections
      },
      "duplicate"
    );
  };

  const exportDocument = () => {
    if (!selected) return;
    const blob = new Blob(
      [JSON.stringify({ document: selected, sections, versions: selectedVersions }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${text(selected, "slug")}-minuta.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!snapshot)
    return (
      <section className="panel-card legal-loading" aria-live="polite">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="secondary-button" onClick={() => void load()}>
              Tentar novamente
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" />
            <p>Carregando políticas e documentos…</p>
          </>
        )}
      </section>
    );
  const capability = (name: Capability) => snapshot.capabilities[name] === true;

  return (
    <div className="legal-center">
      <section className="panel-card legal-summary">
        <div>
          <span className="technical-eyebrow">Conteúdo jurídico</span>
          <h2>Políticas e documentos legais</h2>
          <p>
            Minutas versionadas, consentimentos e solicitações com revisão e aprovação separadas.
          </p>
        </div>
        <a
          className="secondary-button"
          href={`${process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000"}/politicas`}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink /> Centro público
        </a>
      </section>
      <nav className="legal-tabs" aria-label="Áreas do centro jurídico">
        {tabs.map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
            {item.replaceAll("-", " ")}
          </button>
        ))}
      </nav>
      {(message || error) && (
        <p className={`legal-feedback ${error ? "error" : ""}`} role={error ? "alert" : "status"}>
          {error || message}
        </p>
      )}

      {tab === "visao-geral" && (
        <Overview
          snapshot={snapshot}
          onOpen={(status) => {
            setTab("documentos");
            const target = snapshot.documents.find((item) => text(item, "status") === status);
            if (target) edit(target);
          }}
        />
      )}
      {tab === "documentos" && (
        <div className="legal-workspace">
          <section className="panel-card legal-document-list">
            <div className="legal-list-heading">
              <h3>Documentos</h3>
              {capability("legal_content.create") && (
                <button
                  className="primary-button"
                  onClick={() => {
                    setCreating(true);
                    setSelectedId("");
                    setDraft(emptyDraft);
                    setSections([emptySection]);
                  }}
                >
                  <Plus /> Nova minuta
                </button>
              )}
            </div>
            {snapshot.documents.map((document) => (
              <button
                key={text(document, "id")}
                className={selectedId === text(document, "id") ? "active" : ""}
                onClick={() => edit(document)}
              >
                <FileText />
                <span>
                  <strong>{text(document, "public_title")}</strong>
                  <small>
                    {statusLabel(text(document, "status"))} · v
                    {numberValue(document, "next_version")}
                  </small>
                </span>
              </button>
            ))}
          </section>
          <section className="panel-card legal-editor">
            {!selected && !creating ? (
              <div className="admin-empty-state">
                <BookOpenCheck />
                <h3>Selecione uma minuta</h3>
                <p>Documentos publicados não são alterados retroativamente.</p>
              </div>
            ) : (
              <>
                <form onSubmit={(event) => void save(event)}>
                  <div className="legal-editor-heading">
                    <div>
                      <span
                        className={`legal-status status-${text(selected, "status") || "draft"}`}
                      >
                        {creating ? "Nova minuta" : statusLabel(text(selected, "status"))}
                      </span>
                      <h3>{draft.public_title || "Documento sem título"}</h3>
                    </div>
                    <div className="legal-editor-actions">
                      {!creating && (
                        <button
                          type="button"
                          className="icon-button"
                          title="Exportar"
                          onClick={exportDocument}
                        >
                          <Download />
                        </button>
                      )}
                      {!creating && capability("legal_content.create") && (
                        <button
                          type="button"
                          className="icon-button"
                          title="Duplicar"
                          onClick={() => void duplicate()}
                        >
                          <Copy />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="legal-form-grid">
                    <label>
                      Nome interno
                      <input
                        required
                        value={draft.internal_name}
                        onChange={(event) =>
                          setDraft({ ...draft, internal_name: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Título público
                      <input
                        required
                        value={draft.public_title}
                        onChange={(event) =>
                          setDraft({ ...draft, public_title: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Identificador da rota
                      <input
                        required
                        pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                        value={draft.slug}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            slug: event.target.value.toLowerCase().replaceAll(/[^a-z0-9-]/gu, "-")
                          })
                        }
                      />
                    </label>
                    <label>
                      Tipo
                      <input
                        required
                        value={draft.document_type}
                        onChange={(event) =>
                          setDraft({ ...draft, document_type: event.target.value })
                        }
                      />
                    </label>
                    <label className="wide">
                      Resumo
                      <textarea
                        value={draft.summary}
                        onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                      />
                    </label>
                    <label>
                      Idioma
                      <input
                        value={draft.language}
                        onChange={(event) => setDraft({ ...draft, language: event.target.value })}
                      />
                    </label>
                    <label>
                      Público
                      <input
                        value={draft.audience}
                        onChange={(event) => setDraft({ ...draft, audience: event.target.value })}
                      />
                    </label>
                    <label className="wide">
                      Locais de exibição
                      <input
                        value={draft.display_locations.join(", ")}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            display_locations: event.target.value
                              .split(",")
                              .map((item) => item.trim())
                              .filter(Boolean)
                          })
                        }
                        placeholder="footer, signup, checkout"
                      />
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={draft.requires_acceptance}
                        onChange={(event) =>
                          setDraft({ ...draft, requires_acceptance: event.target.checked })
                        }
                      />
                      Exige aceite
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={draft.requires_new_acceptance}
                        onChange={(event) =>
                          setDraft({ ...draft, requires_new_acceptance: event.target.checked })
                        }
                      />
                      Exige novo aceite
                    </label>
                    <label className="wide">
                      Resumo das alterações
                      <textarea
                        value={draft.change_summary}
                        onChange={(event) =>
                          setDraft({ ...draft, change_summary: event.target.value })
                        }
                      />
                    </label>
                    <label className="wide">
                      Observações internas
                      <textarea
                        value={draft.internal_notes}
                        onChange={(event) =>
                          setDraft({ ...draft, internal_notes: event.target.value })
                        }
                      />
                    </label>
                    <fieldset className="wide legal-reference-picker">
                      <legend>Referências relacionadas</legend>
                      {snapshot.references.map((reference) => {
                        const id = text(reference, "id");
                        return (
                          <label className="check-row" key={id}>
                            <input
                              type="checkbox"
                              checked={draft.reference_ids.includes(id)}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  reference_ids: event.target.checked
                                    ? [...draft.reference_ids, id]
                                    : draft.reference_ids.filter(
                                        (referenceId) => referenceId !== id
                                      )
                                })
                              }
                            />
                            {text(reference, "name")}
                          </label>
                        );
                      })}
                    </fieldset>
                  </div>
                  <div className="legal-sections-heading">
                    <h4>Seções numeradas</h4>
                    {(creating ||
                      ["draft", "changes_requested"].includes(text(selected, "status"))) && (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          setSections((current) => [
                            ...current,
                            {
                              section_number: String(current.length + 1),
                              title: "Nova seção",
                              content: "",
                              sort_order: current.length + 1
                            }
                          ])
                        }
                      >
                        <Plus /> Adicionar
                      </button>
                    )}
                  </div>
                  <div className="legal-section-editor">
                    {sections.map((section, index) => (
                      <fieldset key={`${section.section_number}-${index}`}>
                        <legend>Seção {section.section_number}</legend>
                        <label>
                          Número
                          <input
                            required
                            value={section.section_number}
                            onChange={(event) =>
                              setSections((current) =>
                                current.map((item, position) =>
                                  position === index
                                    ? { ...item, section_number: event.target.value }
                                    : item
                                )
                              )
                            }
                          />
                        </label>
                        <label>
                          Título
                          <input
                            required
                            value={section.title}
                            onChange={(event) =>
                              setSections((current) =>
                                current.map((item, position) =>
                                  position === index ? { ...item, title: event.target.value } : item
                                )
                              )
                            }
                          />
                        </label>
                        <label>
                          Conteúdo
                          <textarea
                            rows={6}
                            value={section.content}
                            onChange={(event) =>
                              setSections((current) =>
                                current.map((item, position) =>
                                  position === index
                                    ? { ...item, content: event.target.value }
                                    : item
                                )
                              )
                            }
                          />
                        </label>
                      </fieldset>
                    ))}
                  </div>
                  {(creating ||
                    ["draft", "changes_requested"].includes(text(selected, "status"))) &&
                    capability(creating ? "legal_content.create" : "legal_content.edit") && (
                      <button className="primary-button" disabled={Boolean(pending)}>
                        {pending === "save" ? <LoaderCircle className="spin" /> : <Save />} Salvar
                        minuta
                      </button>
                    )}
                </form>
                {!creating && (
                  <WorkflowActions
                    document={selected!}
                    capabilities={snapshot.capabilities}
                    pending={pending}
                    transition={transition}
                  />
                )}
                {!creating && (
                  <VersionHistory
                    versions={selectedVersions}
                    canRestore={capability("legal_content.publish")}
                    pending={pending}
                    onRestore={async (versionId) => {
                      const reason = window
                        .prompt("Motivo para restaurar esta versão como nova minuta:")
                        ?.trim();
                      if (reason)
                        await request(
                          "PATCH",
                          { kind: "restore_version", versionId, reason },
                          "restore-version"
                        );
                    }}
                  />
                )}
                <article className="legal-preview">
                  <span>Pré-visualização da minuta</span>
                  <h2>{draft.public_title}</h2>
                  <p>{draft.summary}</p>
                  <nav aria-label="Índice da minuta">
                    {sections.map((section) => (
                      <a href={`#preview-${section.section_number}`} key={section.section_number}>
                        {section.section_number} {section.title}
                      </a>
                    ))}
                  </nav>
                  {sections.map((section) => (
                    <section id={`preview-${section.section_number}`} key={section.section_number}>
                      <h3>
                        {section.section_number} {section.title}
                      </h3>
                      {section.content
                        .split(/\n+/u)
                        .filter(Boolean)
                        .map((paragraph) => (
                          <p key={paragraph}>{paragraph}</p>
                        ))}
                    </section>
                  ))}
                </article>
              </>
            )}
          </section>
        </div>
      )}
      {tab === "empresa" && (
        <CompanyForm
          company={snapshot.company}
          canEdit={capability("legal_content.edit")}
          pending={pending}
          onSave={(body) => request("PATCH", body, "company")}
        />
      )}
      {tab === "cookies" && (
        <CookieInventory
          snapshot={snapshot}
          canManage={capability("cookie_settings.manage")}
          pending={pending}
          request={request}
        />
      )}
      {tab === "aceites" && (
        <AcceptanceTable
          items={snapshot.acceptances}
          allowed={capability("legal_acceptance.view")}
        />
      )}
      {tab === "solicitacoes" && (
        <PrivacyRequests
          items={snapshot.requests}
          allowed={capability("privacy_request.manage")}
          pending={pending}
          request={request}
        />
      )}
      {tab === "referencias" && (
        <References
          items={snapshot.references}
          canEdit={capability("legal_content.edit")}
          pending={pending}
          request={request}
        />
      )}
      {tab === "auditoria" && (
        <AuditTrail items={snapshot.reviews} documents={snapshot.documents} />
      )}
    </div>
  );
}

function Overview({ snapshot, onOpen }: { snapshot: Snapshot; onOpen: (status: string) => void }) {
  const statuses = ["draft", "under_review", "approved", "scheduled", "published", "archived"];
  return (
    <>
      <div className="legal-metrics">
        {statuses.map((status) => (
          <button key={status} onClick={() => onOpen(status)}>
            <span>
              {snapshot.documents.filter((item) => text(item, "status") === status).length}
            </span>
            <small>{statusLabel(status)}</small>
          </button>
        ))}
      </div>
      <section className="panel-card legal-alerts">
        <h3>Pendências para publicação segura</h3>
        <ul>
          <li className={snapshot.company?.completeness_status === "complete" ? "done" : ""}>
            <ShieldCheck /> Dados empresariais configuráveis completos
          </li>
          <li
            className={
              snapshot.documents.some((item) => text(item, "status") === "legally_reviewed")
                ? "done"
                : ""
            }
          >
            <BookOpenCheck /> Revisão jurídica registrada
          </li>
          <li
            className={
              snapshot.documents.some((item) => text(item, "status") === "approved") ? "done" : ""
            }
          >
            <CheckCircle2 /> Aprovação gerencial registrada
          </li>
        </ul>
        <p>
          As minutas iniciais não foram publicadas e contêm placeholders claramente identificados.
        </p>
      </section>
    </>
  );
}

function WorkflowActions({
  document,
  capabilities,
  pending,
  transition
}: {
  document: Item;
  capabilities: Snapshot["capabilities"];
  pending: string;
  transition: (action: string) => Promise<void>;
}) {
  const status = text(document, "status");
  const actions: Array<[string, string, Capability]> = [];
  if (["draft", "changes_requested"].includes(status))
    actions.push(["submit_review", "Enviar para revisão", "legal_content.edit"]);
  if (status === "under_review")
    actions.push(
      ["request_changes", "Solicitar correção", "legal_content.review"],
      ["legally_reviewed", "Marcar revisão jurídica", "legal_content.review"]
    );
  if (status === "legally_reviewed")
    actions.push(["approve", "Aprovar minuta", "legal_content.publish"]);
  if (status === "approved")
    actions.push(
      ["publish", "Publicar", "legal_content.publish"],
      ["schedule", "Agendar", "legal_content.publish"]
    );
  if (["published", "scheduled"].includes(status))
    actions.push(
      ["begin_revision", "Iniciar nova revisão", "legal_content.edit"],
      ["archive", "Arquivar", "legal_content.archive"]
    );
  if (status === "archived")
    actions.push(["restore", "Restaurar como minuta", "legal_content.publish"]);
  return (
    <div className="legal-workflow-actions">
      {actions
        .filter(([, , permission]) => capabilities[permission])
        .map(([action, label]) => (
          <button
            key={action}
            className="secondary-button"
            disabled={Boolean(pending)}
            onClick={() => void transition(action)}
          >
            {action === "archive" ? (
              <Archive />
            ) : action === "submit_review" ? (
              <Send />
            ) : (
              <CheckCircle2 />
            )}
            {label}
          </button>
        ))}
    </div>
  );
}

function VersionHistory({
  versions,
  canRestore,
  pending,
  onRestore
}: {
  versions: Item[];
  canRestore: boolean;
  pending: string;
  onRestore: (id: string) => Promise<void>;
}) {
  return (
    <section className="legal-version-history">
      <h4>Versões imutáveis</h4>
      {versions.length ? (
        versions.map((version) => (
          <div key={text(version, "id")}>
            <span>
              v{numberValue(version, "version")} · {date(version.published_at)}
            </span>
            <code>{text(version, "content_hash").slice(0, 16)}…</code>
            {canRestore && (
              <button
                className="text-button"
                disabled={Boolean(pending)}
                onClick={() => void onRestore(text(version, "id"))}
              >
                <RefreshCcw /> Restaurar como minuta
              </button>
            )}
          </div>
        ))
      ) : (
        <p>Nenhuma versão publicada.</p>
      )}
      {versions.length >= 2 && (
        <details className="legal-version-compare">
          <summary>Comparar as duas versões mais recentes</summary>
          <div>
            {versions.slice(0, 2).map((version) => (
              <section key={text(version, "id")}>
                <strong>Versão {numberValue(version, "version")}</strong>
                <pre>{snapshotText(version.snapshot)}</pre>
              </section>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function CompanyForm({
  company,
  canEdit,
  pending,
  onSave
}: {
  company: Item | null;
  canEdit: boolean;
  pending: string;
  onSave: (body: unknown) => Promise<boolean>;
}) {
  const fields = [
    ["legalName", "Razão social", "legal_name"],
    ["tradeName", "Nome fantasia", "trade_name"],
    ["taxId", "CNPJ", "tax_id"],
    ["address", "Endereço", "address"],
    ["email", "E-mail", "email"],
    ["phone", "Telefone", "phone"],
    ["privacyChannel", "Canal de privacidade", "privacy_channel"],
    ["dataProtectionContact", "Encarregado ou contato", "data_protection_contact"],
    ["supportChannel", "Atendimento", "support_channel"]
  ] as const;
  return (
    <form
      className="panel-card legal-company-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onSave({
          kind: "company",
          ...Object.fromEntries(fields.map(([key]) => [key, formText(form, key)])),
          completenessStatus: formText(form, "completenessStatus")
        });
      }}
    >
      <h3>Dados empresariais configuráveis</h3>
      <p>
        Esses dados serão congelados em cada versão publicada. Não marque como completos antes da
        conferência documental.
      </p>
      <div className="legal-form-grid">
        {fields.map(([key, label, column]) => (
          <label key={key}>
            {label}
            <input
              name={key}
              defaultValue={text(company, column)}
              disabled={!canEdit}
              placeholder="PREENCHER E VALIDAR"
            />
          </label>
        ))}
        <label>
          Status
          <select
            name="completenessStatus"
            defaultValue={text(company, "completeness_status") || "incomplete"}
            disabled={!canEdit}
          >
            <option value="incomplete">Incompleto</option>
            <option value="review">Em conferência</option>
            <option value="complete">Completo e conferido</option>
          </select>
        </label>
      </div>
      {canEdit && (
        <button className="primary-button" disabled={Boolean(pending)}>
          <Save /> Salvar dados empresariais
        </button>
      )}
    </form>
  );
}

function CookieInventory({
  snapshot,
  canManage,
  pending,
  request
}: {
  snapshot: Snapshot;
  canManage: boolean;
  pending: string;
  request: (method: "POST" | "PATCH", body: unknown, action: string) => Promise<boolean>;
}) {
  return (
    <section className="panel-card">
      <div className="legal-list-heading">
        <div>
          <h3>Inventário real de cookies</h3>
          <p>Categorias sem ferramenta configurada permanecem inativas.</p>
        </div>
      </div>
      <div className="responsive-table">
        <table>
          <thead>
            <tr>
              <th>Cookie</th>
              <th>Categoria</th>
              <th>Fornecedor</th>
              <th>Finalidade</th>
              <th>Duração</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.cookies.map((cookie) => (
              <tr key={text(cookie, "id")}>
                <td>
                  <code>{text(cookie, "name_pattern")}</code>
                </td>
                <td>{text(cookie, "category_id")}</td>
                <td>{text(cookie, "provider")}</td>
                <td>{text(cookie, "purpose")}</td>
                <td>{text(cookie, "duration_description")}</td>
                <td>{bool(cookie, "active") ? "Ativo" : "Inativo"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && (
        <details className="legal-inline-form">
          <summary>Adicionar definição verificada</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void request(
                "POST",
                {
                  kind: "cookie",
                  namePattern: formText(form, "namePattern"),
                  categoryId: formText(form, "categoryId"),
                  provider: formText(form, "provider"),
                  purpose: formText(form, "purpose"),
                  durationDescription: formText(form, "duration"),
                  firstParty: true,
                  active: true
                },
                "cookie"
              ).then((saved) => {
                if (saved) event.currentTarget.reset();
              });
            }}
          >
            <input name="namePattern" placeholder="Nome ou padrão" required />
            <select name="categoryId">
              {snapshot.categories.map((category) => (
                <option key={text(category, "id")} value={text(category, "id")}>
                  {text(category, "label")}
                </option>
              ))}
            </select>
            <input name="provider" placeholder="Fornecedor" required />
            <input name="purpose" placeholder="Finalidade real" required />
            <input name="duration" placeholder="Duração" required />
            <button className="primary-button" disabled={Boolean(pending)}>
              <Plus /> Adicionar
            </button>
          </form>
        </details>
      )}
    </section>
  );
}

function AcceptanceTable({ items, allowed }: { items: Item[]; allowed: boolean }) {
  return (
    <section className="panel-card">
      <h3>Aceites versionados</h3>
      {!allowed ? (
        <p>Seu perfil não possui permissão para consultar aceites.</p>
      ) : items.length ? (
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Contexto</th>
                <th>Versão</th>
                <th>Tipo</th>
                <th>Data</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={text(item, "id")}>
                  <td>{text(item, "context")}</td>
                  <td>
                    <code>{text(item, "document_version_id").slice(0, 8)}</code>
                  </td>
                  <td>{text(item, "acceptance_type")}</td>
                  <td>{date(item.accepted_at)}</td>
                  <td>
                    {item.revoked_at ? "Revogado" : bool(item, "accepted") ? "Aceito" : "Recusado"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>Nenhum aceite de versão publicada.</p>
      )}
    </section>
  );
}

function PrivacyRequests({
  items,
  allowed,
  pending,
  request
}: {
  items: Item[];
  allowed: boolean;
  pending: string;
  request: (method: "POST" | "PATCH", body: unknown, action: string) => Promise<boolean>;
}) {
  return (
    <section className="panel-card">
      <h3>Solicitações de titulares</h3>
      {!allowed ? (
        <p>Seu perfil não gerencia dados pessoais de solicitações.</p>
      ) : items.length ? (
        <div className="legal-request-list">
          {items.map((item) => (
            <details key={text(item, "id")}>
              <summary>
                <span>
                  <strong>{text(item, "public_code")}</strong> · {text(item, "request_type")}
                </span>
                <small>
                  {text(item, "status")} · {date(item.requested_at)}
                </small>
              </summary>
              <p>
                <strong>Solicitante:</strong> {text(item, "requester_name")} ·{" "}
                {text(item, "requester_email")}
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void request(
                    "PATCH",
                    {
                      kind: "privacy_request",
                      id: text(item, "id"),
                      status: formText(form, "status"),
                      identityStatus: formText(form, "identityStatus"),
                      responseSummary: formText(form, "responseSummary"),
                      publicNote: formText(form, "publicNote")
                    },
                    `privacy-${text(item, "id")}`
                  );
                }}
              >
                <label>
                  Identidade
                  <select name="identityStatus" defaultValue={text(item, "identity_status")}>
                    <option value="pending">Pendente</option>
                    <option value="verified">Verificada</option>
                    <option value="rejected">Rejeitada</option>
                  </select>
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={text(item, "status")}>
                    <option value="requested">Solicitada</option>
                    <option value="identity_verification">Verificando identidade</option>
                    <option value="in_progress">Em análise</option>
                    <option value="answered">Respondida</option>
                    <option value="rejected">Rejeitada</option>
                    <option value="completed">Concluída</option>
                  </select>
                </label>
                <label>
                  Resposta interna
                  <textarea name="responseSummary" defaultValue={text(item, "response_summary")} />
                </label>
                <label>
                  Atualização visível ao titular
                  <textarea name="publicNote" required />
                </label>
                <button className="primary-button" disabled={Boolean(pending)}>
                  <Save /> Registrar andamento
                </button>
              </form>
            </details>
          ))}
        </div>
      ) : (
        <p>Nenhuma solicitação recebida.</p>
      )}
    </section>
  );
}

function References({
  items,
  canEdit,
  pending,
  request
}: {
  items: Item[];
  canEdit: boolean;
  pending: string;
  request: (method: "POST" | "PATCH", body: unknown, action: string) => Promise<boolean>;
}) {
  return (
    <section className="panel-card">
      <h3>Referências oficiais</h3>
      <div className="legal-reference-list">
        {items.map((item) => (
          <a
            key={text(item, "id")}
            href={text(item, "official_url")}
            target="_blank"
            rel="noreferrer"
          >
            <strong>{text(item, "name")}</strong>
            <span>
              {text(item, "related_article") || "Fonte institucional"} · consulta em{" "}
              {date(`${text(item, "consulted_on")}T12:00:00Z`)}
            </span>
            <ExternalLink />
          </a>
        ))}
      </div>
      {canEdit && (
        <details className="legal-inline-form">
          <summary>Cadastrar referência</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void request(
                "POST",
                {
                  kind: "reference",
                  name: formText(form, "name"),
                  relatedArticle: formText(form, "article"),
                  officialUrl: formText(form, "url"),
                  notes: formText(form, "notes")
                },
                "reference"
              ).then((saved) => {
                if (saved) event.currentTarget.reset();
              });
            }}
          >
            <input name="name" required placeholder="Norma ou orientação" />
            <input name="article" placeholder="Artigo relacionado" />
            <input name="url" type="url" required placeholder="https://fonte-oficial…" />
            <input name="notes" placeholder="Notas de aplicação" />
            <button className="primary-button" disabled={Boolean(pending)}>
              <Plus /> Cadastrar
            </button>
          </form>
        </details>
      )}
    </section>
  );
}

function AuditTrail({ items, documents }: { items: Item[]; documents: Item[] }) {
  return (
    <section className="panel-card">
      <h3>Trilha editorial</h3>
      <div className="legal-audit-list">
        {items.length ? (
          items.map((item) => (
            <div key={text(item, "id")}>
              <FileClock />
              <span>
                <strong>
                  {(documents.find((document) => text(document, "id") === text(item, "document_id"))
                    ?.public_title as string) ?? "Documento"}
                </strong>
                <small>
                  {statusLabel(text(item, "decision"))} · {text(item, "reason")} ·{" "}
                  {date(item.created_at)}
                </small>
              </span>
            </div>
          ))
        ) : (
          <p>Nenhuma decisão editorial registrada.</p>
        )}
      </div>
    </section>
  );
}

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
          rel="noreferrer"
        >
          <ExternalLink /> Abrir centro público
        </a>
      </div>
    </section>
  );
}
