"use client";

import {
  Archive,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FileEdit,
  FolderTree,
  History,
  LoaderCircle,
  MessageSquareText,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Trash2,
  XCircle
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { usePanelPrompt } from "./panel-prompt";

type Item = Record<string, unknown>;
type Snapshot = {
  contents: Item[];
  categories: Item[];
  versions: Item[];
  relations: Item[];
  searches: Item[];
  feedback: Item[];
  tickets: Item[];
  replies: Item[];
  audit: Item[];
  capabilities: Record<string, boolean>;
  userId: string;
};
type Tab = "overview" | "contents" | "categories" | "replies" | "metrics" | "audit";

const emptyDraft = {
  categoryId: "",
  type: "faq",
  slug: "",
  title: "",
  summary: "",
  body: "",
  keywords: "",
  synonyms: "",
  audiences: ["visitor", "customer"],
  priority: 0,
  mediaType: "video",
  mediaLabel: "",
  mediaUrl: "",
  actionLabel: "",
  actionHref: "",
  relatedIds: [] as string[]
};

const labels: Record<string, string> = {
  draft: "Rascunho",
  under_review: "Em revisão",
  changes_requested: "Correções solicitadas",
  approved: "Aprovado",
  scheduled: "Agendado",
  published: "Publicado",
  outdated: "Desatualizado",
  archived: "Arquivado"
};

const text = (item: Item | undefined | null, key: string) => {
  const value = item?.[key];
  return typeof value === "string" ? value : "";
};
const number = (item: Item | undefined | null, key: string) => {
  const value = item?.[key];
  return typeof value === "number" ? value : 0;
};
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const rows = (value: unknown): Item[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Item => Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
const formatDate = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo"
      }).format(new Date(value))
    : "—";

export function HelpContentCenter() {
  const requestPrompt = usePanelPrompt();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/help-content", { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload))
        throw new Error();
      const data = payload as Item;
      setSnapshot({
        contents: rows(data.contents),
        categories: rows(data.categories),
        versions: rows(data.versions),
        relations: rows(data.relations),
        searches: rows(data.searches),
        feedback: rows(data.feedback),
        tickets: rows(data.tickets),
        replies: rows(data.replies),
        audit: rows(data.audit),
        capabilities:
          data.capabilities &&
          typeof data.capabilities === "object" &&
          !Array.isArray(data.capabilities)
            ? (data.capabilities as Record<string, boolean>)
            : {},
        userId: typeof data.userId === "string" ? data.userId : ""
      });
    } catch {
      setError("Não foi possível carregar o conteúdo de atendimento.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  const selected = snapshot?.contents.find((item) => text(item, "id") === selectedId);
  useEffect(() => {
    if (!selected) return;
    const action =
      selected.related_action &&
      typeof selected.related_action === "object" &&
      !Array.isArray(selected.related_action)
        ? (selected.related_action as Item)
        : null;
    const media = rows(selected.media)[0];
    setDraft({
      categoryId: text(selected, "category_id"),
      type: text(selected, "content_type") || "faq",
      slug: text(selected, "slug"),
      title: text(selected, "title"),
      summary: text(selected, "summary"),
      body: text(selected, "body"),
      keywords: strings(selected.keywords).join(", "),
      synonyms: strings(selected.synonyms).join(", "),
      audiences: strings(selected.audiences),
      priority: number(selected, "priority"),
      mediaType: text(media, "type") || "video",
      mediaLabel: text(media, "label"),
      mediaUrl: text(media, "url"),
      actionLabel: text(action, "label"),
      actionHref: text(action, "href"),
      relatedIds:
        snapshot?.relations
          .filter((relation) => text(relation, "content_id") === selectedId)
          .map((relation) => text(relation, "related_content_id")) ?? []
    });
    setCreating(false);
  }, [selected, selectedId, snapshot?.relations]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return (snapshot?.contents ?? []).filter(
      (item) =>
        (status === "all" || text(item, "status") === status) &&
        (!normalized ||
          `${text(item, "title")} ${text(item, "summary")}`
            .toLocaleLowerCase("pt-BR")
            .includes(normalized))
    );
  }, [query, snapshot?.contents, status]);

  const capability = (permission: string) => snapshot?.capabilities[permission] === true;
  const payload = () => ({
    category_id: draft.categoryId,
    content_type: draft.type,
    slug: draft.slug,
    title: draft.title,
    summary: draft.summary,
    body: draft.body,
    keywords: draft.keywords
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    synonyms: draft.synonyms
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    audiences: draft.audiences,
    priority: draft.priority,
    media:
      draft.mediaUrl && draft.mediaLabel
        ? [{ type: draft.mediaType, label: draft.mediaLabel, url: draft.mediaUrl }]
        : [],
    attachments: [],
    related_action:
      draft.actionLabel && draft.actionHref
        ? { label: draft.actionLabel, href: draft.actionHref }
        : null,
    related_ids: draft.relatedIds
  });

  const request = async (method: "POST" | "PATCH" | "DELETE", body: Item, success: string) => {
    if (pending) return false;
    setPending(typeof body.kind === "string" ? body.kind : method);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/help-content", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(result.message ?? "Não foi possível concluir a operação.");
        return false;
      }
      setNotice(success);
      await load();
      return true;
    } catch {
      setError("Conexão interrompida. A alteração não foi concluída.");
      return false;
    } finally {
      setPending("");
    }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) {
      const done = await request(
        "POST",
        { kind: "content", payload: payload() },
        "Rascunho criado."
      );
      if (done) setCreating(false);
    } else if (selected) {
      const form = new FormData(event.currentTarget);
      await request(
        "PATCH",
        {
          kind: "content",
          id: text(selected, "id"),
          payload: payload(),
          changeSummary: form.get("changeSummary")
        },
        "Nova versão de edição salva."
      );
    }
  };

  const transition = async (action: string) => {
    if (!selected) return;
    const reason = await requestPrompt({
      title: action === "schedule" ? "Agendar conteúdo" : "Atualizar conteúdo",
      label: action === "schedule" ? "Motivo do agendamento" : "Justificativa da ação",
      minLength: 3
    });
    if (!reason) return;
    let scheduledAt: string | null = null;
    if (action === "schedule") {
      const value = await requestPrompt({
        title: "Agendar conteúdo",
        label: "Data e hora da publicação",
        multiline: false,
        inputType: "datetime-local"
      });
      if (!value) return;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        setError("Informe uma data de agendamento válida e com fuso horário.");
        return;
      }
      scheduledAt = date.toISOString();
    }
    await request(
      "PATCH",
      { kind: "transition", id: text(selected, "id"), action, reason, scheduledAt },
      `Ação “${action}” concluída.`
    );
  };

  if (!snapshot)
    return (
      <div className="panel-card help-admin-loading">
        {error ? (
          <>
            <XCircle />
            <p>{error}</p>
            <button className="secondary-button" onClick={() => void load()}>
              Tentar novamente
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" />
            <p>Carregando Central de Ajuda…</p>
          </>
        )}
      </div>
    );

  const tabs: Array<[Tab, string, typeof BookOpen]> = [
    ["overview", "Visão geral", BarChart3],
    ["contents", "Conteúdos", BookOpen],
    ["categories", "Categorias", FolderTree],
    ["replies", "Respostas rápidas", MessageSquareText],
    ["metrics", "Métricas", BarChart3],
    ["audit", "Auditoria", History]
  ];
  return (
    <div className="help-admin-center">
      <nav className="help-admin-tabs" aria-label="Central de Ajuda">
        {tabs.map(([value, label, Icon]) => (
          <button
            key={value}
            className={tab === value ? "active" : ""}
            onClick={() => setTab(value)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p className="support-feedback error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="support-feedback success" role="status">
          <CheckCircle2 />
          {notice}
        </p>
      )}

      {tab === "overview" && <Overview snapshot={snapshot} onNavigate={setTab} />}
      {tab === "contents" && (
        <div className="help-admin-workspace">
          <section className="panel-card help-admin-list">
            <header>
              <div>
                <h2>Conteúdos</h2>
                <p>Rascunhos não alteram a versão pública.</p>
              </div>
              {capability("support_content.create") && (
                <button
                  className="primary-button"
                  onClick={() => {
                    setCreating(true);
                    setSelectedId("");
                    setDraft({ ...emptyDraft, categoryId: text(snapshot.categories[0], "id") });
                  }}
                >
                  <Plus />
                  Novo
                </button>
              )}
            </header>
            <div className="support-filters">
              <label>
                <Search />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Título ou resumo"
                />
              </label>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">Todos os status</option>
                {Object.entries(labels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <nav aria-label="Conteúdos da ajuda">
              {filtered.map((item) => (
                <button
                  key={text(item, "id")}
                  className={selectedId === text(item, "id") ? "active" : ""}
                  onClick={() => setSelectedId(text(item, "id"))}
                >
                  <span>
                    <strong>{text(item, "title")}</strong>
                    <small>
                      {text(item, "content_type")} · v{number(item, "current_version")}
                    </small>
                  </span>
                  <i className={`status ${text(item, "status")}`}>
                    {labels[text(item, "status")] ?? text(item, "status")}
                  </i>
                </button>
              ))}
            </nav>
          </section>
          <section className="panel-card help-admin-editor">
            {creating || selected ? (
              <ContentEditor
                draft={draft}
                setDraft={setDraft}
                snapshot={snapshot}
                selected={selected}
                creating={creating}
                pending={pending}
                canEdit={
                  creating
                    ? capability("support_content.create")
                    : capability("support_content.edit")
                }
                onSave={(event) => void save(event)}
                onCancel={() => {
                  setCreating(false);
                  setSelectedId("");
                }}
                onTransition={(action) => void transition(action)}
                capabilities={snapshot.capabilities}
                onRequest={request}
              />
            ) : (
              <div className="support-state">
                <FileEdit />
                <strong>Selecione ou crie um conteúdo</strong>
                <span>O editor, preview e histórico aparecerão aqui.</span>
              </div>
            )}
          </section>
        </div>
      )}
      {tab === "categories" && (
        <Categories
          snapshot={snapshot}
          canManage={capability("support_settings.manage")}
          onRequest={request}
          pending={pending}
        />
      )}
      {tab === "replies" && (
        <QuickReplies
          snapshot={snapshot}
          canManage={capability("support_settings.manage")}
          onRequest={request}
          pending={pending}
        />
      )}
      {tab === "metrics" && <Metrics snapshot={snapshot} />}
      {tab === "audit" && <Audit items={snapshot.audit} />}
    </div>
  );
}

function Overview({
  snapshot,
  onNavigate
}: {
  snapshot: Snapshot;
  onNavigate: (tab: Tab) => void;
}) {
  const count = (status: string) =>
    snapshot.contents.filter((item) => text(item, "status") === status).length;
  return (
    <div className="help-admin-overview">
      <section className="help-admin-kpis">
        {[
          ["Conteúdos", snapshot.contents.length, BookOpen],
          ["Em revisão", count("under_review"), Clock3],
          ["Publicados", count("published"), CheckCircle2],
          ["Chamados", snapshot.tickets.length, MessageSquareText],
          [
            "Buscas sem resultado",
            snapshot.searches.filter((item) => number(item, "result_count") === 0).length,
            Search
          ]
        ].map(([label, value, Icon]) => {
          const CardIcon = Icon as typeof BookOpen;
          return (
            <article className="panel-card" key={String(label)}>
              <CardIcon />
              <span>{label as string}</span>
              <strong>{value as number}</strong>
            </article>
          );
        })}
      </section>
      <section className="panel-card">
        <h2>Fluxo editorial</h2>
        <p>
          Administrador e Operacional criam rascunhos. A Gerência revisa e publica versões
          imutáveis.
        </p>
        <button className="secondary-button" onClick={() => onNavigate("contents")}>
          Abrir conteúdos
        </button>
      </section>
    </div>
  );
}

function ContentEditor({
  draft,
  setDraft,
  snapshot,
  selected,
  creating,
  pending,
  canEdit,
  onSave,
  onCancel,
  onTransition,
  capabilities,
  onRequest
}: {
  draft: typeof emptyDraft;
  setDraft: React.Dispatch<React.SetStateAction<typeof emptyDraft>>;
  snapshot: Snapshot;
  selected?: Item;
  creating: boolean;
  pending: string;
  canEdit: boolean;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onTransition: (action: string) => void;
  capabilities: Record<string, boolean>;
  onRequest: (method: "POST" | "PATCH" | "DELETE", body: Item, success: string) => Promise<boolean>;
}) {
  const requestPrompt = usePanelPrompt();
  const status = text(selected, "status");
  const versions = snapshot.versions.filter(
    (item) => text(item, "content_id") === text(selected, "id")
  );
  const restoreVersion = async (item: Item) => {
    const reason = await requestPrompt({
      title: "Restaurar versão",
      label: "Motivo da restauração",
      minLength: 3
    });
    if (reason) {
      await onRequest(
        "PATCH",
        { kind: "restore_version", versionId: text(item, "id"), reason },
        "Versão restaurada como rascunho."
      );
    }
  };
  const set = <K extends keyof typeof emptyDraft>(key: K, value: (typeof emptyDraft)[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">{creating ? "Novo rascunho" : labels[status]}</p>
          <h2>{creating ? "Criar conteúdo" : text(selected, "title")}</h2>
        </div>
        <button className="icon-button" onClick={onCancel} aria-label="Fechar editor">
          <XCircle />
        </button>
      </header>
      <form className="help-content-form" onSubmit={(event) => void onSave(event)}>
        <label>
          Título
          <input
            required
            minLength={3}
            maxLength={180}
            value={draft.title}
            onChange={(event) => set("title", event.target.value)}
            disabled={!canEdit}
          />
        </label>
        <label>
          Slug
          <input
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            value={draft.slug}
            onChange={(event) => set("slug", event.target.value)}
            disabled={!canEdit}
          />
        </label>
        <label>
          Categoria
          <select
            required
            value={draft.categoryId}
            onChange={(event) => set("categoryId", event.target.value)}
            disabled={!canEdit}
          >
            {snapshot.categories.map((item) => (
              <option value={text(item, "id")} key={text(item, "id")}>
                {text(item, "name")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipo
          <select
            value={draft.type}
            onChange={(event) => set("type", event.target.value)}
            disabled={!canEdit}
          >
            {[
              "faq",
              "article",
              "tutorial",
              "step_by_step",
              "notice",
              "video",
              "document",
              "quick_reply",
              "contextual"
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="wide">
          Resumo
          <textarea
            maxLength={1000}
            value={draft.summary}
            onChange={(event) => set("summary", event.target.value)}
            disabled={!canEdit}
          />
        </label>
        <label className="wide">
          Conteúdo seguro
          <textarea
            className="content-body"
            maxLength={30000}
            value={draft.body}
            onChange={(event) => set("body", event.target.value)}
            disabled={!canEdit}
          />
          <small>
            Texto simples; scripts, iframes e links inseguros são bloqueados no servidor.
          </small>
        </label>
        <label>
          Palavras-chave
          <input
            value={draft.keywords}
            onChange={(event) => set("keywords", event.target.value)}
            placeholder="pedido, rastreio"
            disabled={!canEdit}
          />
        </label>
        <label>
          Sinônimos
          <input
            value={draft.synonyms}
            onChange={(event) => set("synonyms", event.target.value)}
            placeholder="compra, encomenda"
            disabled={!canEdit}
          />
        </label>
        <fieldset className="wide">
          <legend>Públicos</legend>
          {[
            "visitor",
            "customer",
            "representative",
            "operational",
            "admin",
            "manager",
            "technical"
          ].map((audience) => (
            <label className="check" key={audience}>
              <input
                type="checkbox"
                checked={draft.audiences.includes(audience)}
                onChange={(event) =>
                  set(
                    "audiences",
                    event.target.checked
                      ? [...draft.audiences, audience]
                      : draft.audiences.filter((item) => item !== audience)
                  )
                }
                disabled={!canEdit}
              />
              {audience}
            </label>
          ))}
        </fieldset>
        <label>
          Prioridade
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            value={draft.priority}
            onChange={(event) => set("priority", Number(event.target.value))}
            disabled={!canEdit}
          />
        </label>
        <label>
          Ação relacionada
          <input
            value={draft.actionLabel}
            onChange={(event) => set("actionLabel", event.target.value)}
            placeholder="Ver meus pedidos"
            disabled={!canEdit}
          />
        </label>
        <label>
          Tipo de mídia
          <select
            value={draft.mediaType}
            onChange={(event) => set("mediaType", event.target.value)}
            disabled={!canEdit}
          >
            <option value="video">Vídeo</option>
            <option value="image">Imagem</option>
            <option value="document">Documento</option>
          </select>
        </label>
        <label>
          Rótulo da mídia
          <input
            value={draft.mediaLabel}
            onChange={(event) => set("mediaLabel", event.target.value)}
            placeholder="Abrir tutorial em vídeo"
            disabled={!canEdit}
          />
        </label>
        <label className="wide">
          URL HTTPS da mídia
          <input
            type="url"
            value={draft.mediaUrl}
            onChange={(event) => set("mediaUrl", event.target.value)}
            placeholder="https://…"
            disabled={!canEdit}
          />
        </label>
        <label>
          Rota da ação
          <input
            value={draft.actionHref}
            onChange={(event) => set("actionHref", event.target.value)}
            placeholder="/minha-conta/pedidos"
            disabled={!canEdit}
          />
        </label>
        <label className="wide">
          Conteúdos relacionados
          <select
            multiple
            value={draft.relatedIds}
            onChange={(event) =>
              set(
                "relatedIds",
                Array.from(event.target.selectedOptions, (item) => item.value)
              )
            }
            disabled={!canEdit}
          >
            {snapshot.contents
              .filter((item) => text(item, "id") !== text(selected, "id"))
              .map((item) => (
                <option value={text(item, "id")} key={text(item, "id")}>
                  {text(item, "title")}
                </option>
              ))}
          </select>
        </label>
        {!creating && (
          <label className="wide">
            Resumo das alterações
            <input
              name="changeSummary"
              required
              minLength={3}
              maxLength={1000}
              placeholder="Descreva objetivamente o que mudou"
              disabled={!canEdit}
            />
          </label>
        )}
        <div className="wide help-editor-actions">
          {canEdit && (
            <button className="primary-button" disabled={Boolean(pending)}>
              {pending ? <LoaderCircle className="spin" /> : <Save />}
              {creating ? "Criar rascunho" : "Salvar nova versão"}
            </button>
          )}
          {selected && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                const copy = {
                  ...draft,
                  slug: `${draft.slug}-copia-${Date.now().toString().slice(-5)}`,
                  title: `Cópia de ${draft.title}`
                };
                void onRequest(
                  "POST",
                  {
                    kind: "content",
                    payload: {
                      category_id: copy.categoryId,
                      content_type: copy.type,
                      slug: copy.slug,
                      title: copy.title,
                      summary: copy.summary,
                      body: copy.body,
                      keywords: copy.keywords
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                      synonyms: copy.synonyms
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                      audiences: copy.audiences,
                      priority: copy.priority,
                      media:
                        copy.mediaUrl && copy.mediaLabel
                          ? [
                              {
                                type: copy.mediaType,
                                label: copy.mediaLabel,
                                url: copy.mediaUrl
                              }
                            ]
                          : [],
                      attachments: [],
                      related_action:
                        copy.actionLabel && copy.actionHref
                          ? { label: copy.actionLabel, href: copy.actionHref }
                          : null,
                      related_ids: copy.relatedIds
                    }
                  },
                  "Conteúdo duplicado como rascunho."
                );
              }}
            >
              <Copy />
              Duplicar
            </button>
          )}
          {selected && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                const blob = new Blob([JSON.stringify({ content: selected, versions }, null, 2)], {
                  type: "application/json"
                });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `${text(selected, "slug")}.json`;
                link.click();
                URL.revokeObjectURL(link.href);
              }}
            >
              <Download />
              Exportar
            </button>
          )}
        </div>
      </form>
      {selected && (
        <div className="help-workflow-actions">
          {capabilities.support_content_edit &&
            ["draft", "changes_requested", "outdated"].includes(status) && (
              <button onClick={() => void onTransition("submit_review")}>
                <Send />
                Enviar para revisão
              </button>
            )}
          {capabilities.support_content_review && status === "under_review" && (
            <>
              <button onClick={() => void onTransition("approve")}>
                <CheckCircle2 />
                Aprovar
              </button>
              <button onClick={() => void onTransition("reject")}>
                <XCircle />
                Solicitar correção
              </button>
            </>
          )}
          {capabilities.support_content_publish && status === "approved" && (
            <>
              <button onClick={() => void onTransition("publish")}>
                <CheckCircle2 />
                Publicar
              </button>
              <button onClick={() => void onTransition("schedule")}>
                <Clock3 />
                Agendar
              </button>
            </>
          )}
          {capabilities.support_content_publish && status === "published" && (
            <>
              <button onClick={() => void onTransition("begin_revision")}>
                <FileEdit />
                Criar nova revisão
              </button>
              <button onClick={() => void onTransition("mark_outdated")}>
                <Clock3 />
                Marcar desatualizado
              </button>
              <button onClick={() => void onTransition("unpublish")}>
                <Archive />
                Despublicar
              </button>
            </>
          )}
          {capabilities.support_content_publish && status !== "archived" && (
            <button onClick={() => void onTransition("archive")}>
              <Archive />
              Arquivar
            </button>
          )}
          {capabilities.support_content_publish && status === "archived" && (
            <button onClick={() => void onTransition("restore")}>
              <RefreshCw />
              Restaurar
            </button>
          )}
          {capabilities.support_content_edit &&
            status === "draft" &&
            number(selected, "current_version") === 0 && (
              <button
                className="danger"
                onClick={() => {
                  if (window.confirm("Excluir permanentemente este rascunho nunca versionado?"))
                    void onRequest(
                      "DELETE",
                      { id: text(selected, "id"), confirmation: "EXCLUIR" },
                      "Rascunho excluído."
                    );
                }}
              >
                <Trash2 />
                Excluir
              </button>
            )}
        </div>
      )}
      {selected && (
        <details className="help-version-history">
          <summary>Histórico de versões ({versions.length})</summary>
          {versions.length ? (
            versions.map((item) => (
              <article key={text(item, "id")}>
                <strong>
                  v{number(item, "version")} ·{" "}
                  {labels[text(item, "status")] ?? text(item, "status")}
                </strong>
                <span>{formatDate(text(item, "created_at"))}</span>
                <p>{text(item, "change_summary")}</p>
                {capabilities.support_content_publish && (
                  <button
                    onClick={() => void restoreVersion(item)}
                  >
                    Restaurar esta versão
                  </button>
                )}
              </article>
            ))
          ) : (
            <p>Nenhuma versão salva.</p>
          )}
        </details>
      )}
    </>
  );
}

function Categories({
  snapshot,
  canManage,
  onRequest,
  pending
}: {
  snapshot: Snapshot;
  canManage: boolean;
  onRequest: (method: "POST" | "PATCH" | "DELETE", body: Item, success: string) => Promise<boolean>;
  pending: string;
}) {
  const requestPrompt = usePanelPrompt();
  const editCategory = async (item: Item) => {
    const name = await requestPrompt({
      title: "Editar categoria",
      label: "Nome da categoria",
      defaultValue: text(item, "name"),
      multiline: false,
      minLength: 2
    });
    if (!name) return;
    const description = await requestPrompt({
      title: "Editar categoria",
      label: "Descrição",
      defaultValue: text(item, "description"),
      minLength: 1
    });
    if (description === null) return;
    const sortOrder = Number(await requestPrompt({
      title: "Editar categoria",
      label: "Ordem",
      defaultValue: String(number(item, "sort_order")),
      multiline: false,
      inputType: "number",
      inputMode: "numeric"
    }));
    if (!Number.isInteger(sortOrder)) return;
    await onRequest(
      "PATCH",
      {
        kind: "category",
        id: text(item, "id"),
        name,
        description,
        sortOrder,
        active: item.active !== false,
        publicVisible: item.public_visible !== false
      },
      "Categoria atualizada."
    );
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onRequest(
      "POST",
      {
        kind: "category",
        name: form.get("name"),
        slug: form.get("slug"),
        description: form.get("description"),
        sortOrder: Number(form.get("sortOrder"))
      },
      "Categoria criada."
    ).then((done) => {
      if (done) event.currentTarget.reset();
    });
  };
  return (
    <section className="panel-card help-admin-simple">
      <header>
        <div>
          <h2>Categorias</h2>
          <p>A ordem e a visibilidade são persistidas.</p>
        </div>
      </header>
      <div className="help-category-admin-list">
        {snapshot.categories.map((item) => (
          <article key={text(item, "id")}>
            <span>
              <strong>{text(item, "name")}</strong>
              <small>
                /{text(item, "slug")} · ordem {number(item, "sort_order")}
              </small>
            </span>
            <i>
              {item.active === false
                ? "Inativa"
                : item.public_visible === false
                  ? "Interna"
                  : "Pública"}
            </i>
            {canManage && (
              <div className="help-row-actions">
                <button
                  type="button"
                  onClick={() => void editCategory(item)}
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void onRequest(
                      "PATCH",
                      {
                        kind: "category",
                        id: text(item, "id"),
                        name: text(item, "name"),
                        description: text(item, "description"),
                        sortOrder: number(item, "sort_order"),
                        active: item.active !== false,
                        publicVisible: item.public_visible === false
                      },
                      item.public_visible === false ? "Categoria publicada." : "Categoria ocultada."
                    )
                  }
                >
                  {item.public_visible === false ? "Publicar" : "Ocultar"}
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {canManage && (
        <form className="help-inline-form" onSubmit={submit}>
          <h3>Nova categoria</h3>
          <input name="name" required minLength={2} placeholder="Nome" />
          <input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="slug" />
          <input name="description" maxLength={500} placeholder="Descrição" />
          <input name="sortOrder" type="number" inputMode="numeric" min={0} max={1000} defaultValue={0} />
          <button className="primary-button" disabled={Boolean(pending)}>
            <Plus />
            Criar
          </button>
        </form>
      )}
    </section>
  );
}

function QuickReplies({
  snapshot,
  canManage,
  onRequest,
  pending
}: {
  snapshot: Snapshot;
  canManage: boolean;
  onRequest: (method: "POST" | "PATCH" | "DELETE", body: Item, success: string) => Promise<boolean>;
  pending: string;
}) {
  const requestPrompt = usePanelPrompt();
  const editReply = async (item: Item) => {
    const content = await requestPrompt({
      title: "Editar resposta rápida",
      label: "Conteúdo da resposta",
      defaultValue: text(item, "content"),
      minLength: 1
    });
    if (!content) return;
    await onRequest(
      "PATCH",
      {
        kind: "quick_reply",
        id: text(item, "id"),
        title: text(item, "title"),
        content,
        active: item.active !== false
      },
      "Resposta rápida atualizada."
    );
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onRequest(
      "POST",
      {
        kind: "quick_reply",
        title: form.get("title"),
        shortcut: form.get("shortcut"),
        content: form.get("content"),
        categoryId: form.get("categoryId") || null
      },
      "Resposta rápida criada."
    ).then((done) => {
      if (done) event.currentTarget.reset();
    });
  };
  return (
    <section className="panel-card help-admin-simple">
      <header>
        <div>
          <h2>Respostas rápidas</h2>
          <p>Atalhos internos para respostas humanas; nunca são enviados automaticamente.</p>
        </div>
      </header>
      <div className="help-reply-list">
        {snapshot.replies.map((item) => (
          <article key={text(item, "id")}>
            <strong>
              {text(item, "title")} <code>{text(item, "shortcut")}</code>
            </strong>
            <p>{text(item, "content")}</p>
            {canManage && (
              <div className="help-row-actions">
                <button
                  type="button"
                  onClick={() => void editReply(item)}
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void onRequest(
                      "PATCH",
                      {
                        kind: "quick_reply",
                        id: text(item, "id"),
                        title: text(item, "title"),
                        content: text(item, "content"),
                        active: item.active === false
                      },
                      item.active === false ? "Resposta ativada." : "Resposta desativada."
                    )
                  }
                >
                  {item.active === false ? "Ativar" : "Desativar"}
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {canManage && (
        <form className="help-inline-form wide-form" onSubmit={submit}>
          <h3>Nova resposta rápida</h3>
          <input name="title" required minLength={3} placeholder="Título" />
          <input name="shortcut" required pattern="/[a-z0-9-]{2,40}" placeholder="/atalho" />
          <select name="categoryId" defaultValue="">
            <option value="">Sem categoria</option>
            {snapshot.categories.map((item) => (
              <option value={text(item, "id")} key={text(item, "id")}>
                {text(item, "name")}
              </option>
            ))}
          </select>
          <textarea
            name="content"
            required
            minLength={3}
            maxLength={4000}
            placeholder="Resposta objetiva e validada"
          />
          <button className="primary-button" disabled={Boolean(pending)}>
            <Plus />
            Criar
          </button>
        </form>
      )}
    </section>
  );
}

function Metrics({ snapshot }: { snapshot: Snapshot }) {
  const positives = snapshot.feedback.filter((item) => item.helpful === true).length;
  const negatives = snapshot.feedback.length - positives;
  const noResults = snapshot.searches.filter((item) => number(item, "result_count") === 0);
  const averageMinutes = (endKey: string) => {
    const durations = snapshot.tickets.flatMap((ticket) => {
      const start = Date.parse(text(ticket, "created_at"));
      const end = Date.parse(text(ticket, endKey));
      return Number.isFinite(start) && Number.isFinite(end) ? [(end - start) / 60000] : [];
    });
    return durations.length
      ? Math.round(durations.reduce((total, value) => total + value, 0) / durations.length)
      : null;
  };
  const firstResponse = averageMinutes("first_response_at");
  const resolution = averageMinutes("resolved_at");
  const automaticRate =
    positives + snapshot.tickets.length
      ? Math.round((positives / (positives + snapshot.tickets.length)) * 100)
      : 0;
  return (
    <div className="help-metrics-grid">
      <article className="panel-card">
        <h2>Utilidade</h2>
        <strong>{positives}</strong>
        <span>positivos · {negatives} negativos</span>
      </article>
      <article className="panel-card">
        <h2>Chamados criados</h2>
        <strong>{snapshot.tickets.length}</strong>
        <span>no recorte autorizado para este perfil</span>
      </article>
      <article className="panel-card">
        <h2>Resolução por conteúdo</h2>
        <strong>{automaticRate}%</strong>
        <span>feedbacks positivos em relação a feedbacks positivos e chamados</span>
      </article>
      <article className="panel-card">
        <h2>Primeira resposta média</h2>
        <strong>{firstResponse === null ? "—" : `${firstResponse} min`}</strong>
        <span>calculada apenas quando há resposta registrada</span>
      </article>
      <article className="panel-card">
        <h2>Resolução média</h2>
        <strong>{resolution === null ? "—" : `${resolution} min`}</strong>
        <span>calculada apenas para chamados resolvidos</span>
      </article>
      <article className="panel-card">
        <h2>Buscas sem resultado</h2>
        <strong>{noResults.length}</strong>
        <span>termos anonimizados para análise</span>
      </article>
      <section className="panel-card wide">
        <h2>Termos que precisam de conteúdo</h2>
        {noResults.length ? (
          <ul>
            {noResults.slice(0, 20).map((item) => (
              <li key={String(item.id)}>
                <span>{text(item, "normalized_query")}</span>
                <time>{formatDate(text(item, "created_at"))}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p>Nenhuma busca sem resultado registrada.</p>
        )}
      </section>
    </div>
  );
}
function Audit({ items }: { items: Item[] }) {
  return (
    <section className="panel-card help-audit-list">
      <h2>Auditoria editorial</h2>
      {items.length ? (
        items.map((item) => (
          <article key={String(item.id)}>
            <span>
              <strong>{text(item, "action")}</strong>
              <small>
                {text(item, "actor_role")} · {formatDate(text(item, "created_at"))}
              </small>
            </span>
            <p>{text(item, "reason")}</p>
          </article>
        ))
      ) : (
        <p>Nenhum evento autorizado para este perfil.</p>
      )}
    </section>
  );
}
