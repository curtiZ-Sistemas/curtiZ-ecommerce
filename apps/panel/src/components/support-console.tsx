"use client";

import { resolvePublicAppUrls } from "@curtiz/config";

import {
  supportStatusLabels,
  type SupportConversationView,
  type SupportStatus,
  type SupportTeamMember
} from "@curtiz/domain";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CircleCheck,
  FileText,
  Inbox,
  LoaderCircle,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  UserRoundCheck
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelConfirm, usePanelPrompt } from "./panel-prompt";
import { Code, StateMessage, StatusLabel, type UiTone } from "./panel-ui";

type PanelRole = "operacional" | "administracao" | "gerencia" | "tecnico";

type SupportResponse = {
  ok: boolean;
  conversations?: SupportConversationView[];
  team?: SupportTeamMember[];
  message?: string;
  quickReplies?: Array<{ id: string; title: string; shortcut: string; content: string }>;
};

function storeUrl() {
  return resolvePublicAppUrls(
    typeof window === "undefined" ? undefined : window.location.href
  ).storeUrl;
}

const statusFilters: Array<{ value: "all" | SupportStatus; label: string }> = [
  { value: "all", label: "Todos os status" },
  { value: "queued", label: "Na fila" },
  { value: "in_progress", label: "Em atendimento" },
  { value: "waiting_customer", label: "Aguardando cliente" },
  { value: "escalated", label: "Escalados" },
  { value: "resolved", label: "Resolvidos" },
  { value: "closed", label: "Encerrados" }
];

const roleLabels = {
  operational: "Operacional",
  manager: "Gerência",
  technical: "Técnico"
} as const;

// O mesmo significado usa o mesmo tom nos quatro painéis.
const statusTones: Record<SupportStatus, UiTone> = {
  open: "neutral",
  queued: "neutral",
  assigned: "info",
  in_progress: "info",
  waiting_customer: "warning",
  waiting_internal: "warning",
  escalated: "danger",
  resolved: "success",
  closed: "neutral",
  reopened: "warning",
  spam: "neutral",
  cancelled: "neutral"
};

const priorityLabels: Record<string, string> = { low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente" };

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));

export function SupportConsole({ role }: { role: PanelRole }) {
  const requestPrompt = usePanelPrompt();
  const requestConfirm = usePanelConfirm();
  // Só apresentação: no celular mostra a fila ou a conversa, uma de cada vez.
  const [mobileView, setMobileView] = useState<"list" | "conversation">("list");
  const [conversations, setConversations] = useState<SupportConversationView[]>([]);
  const [team, setTeam] = useState<SupportTeamMember[]>([]);
  const [quickReplies, setQuickReplies] = useState<NonNullable<SupportResponse["quickReplies"]>>(
    []
  );
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | SupportStatus>("all");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [replyText, setReplyText] = useState("");

  const etagRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`${storeUrl()}/api/support`, {
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
        credentials: "include",
        headers: silent && etagRef.current ? { "if-none-match": etagRef.current } : {}
      });
      if (response.status === 304) return;
      const result = (await response.json()) as SupportResponse;
      etagRef.current = response.ok ? response.headers.get("etag") : null;
      if (response.status === 401 || response.status === 403) {
        setConversations([]); setTeam([]); setQuickReplies([]);
      }
      if (!response.ok || !result.ok) throw new Error(result.message ?? "support_load_failed");
      setConversations(result.conversations ?? []);
      setTeam(result.team ?? []);
      setQuickReplies(result.quickReplies ?? []);
      setSelectedId((current) => {
        if (current && result.conversations?.some((item) => item.id === current)) return current;
        return result.conversations?.[0]?.id ?? "";
      });
      setError("");
    } catch {
      setError("Não foi possível carregar a fila. Verifique sua sessão e tente novamente.");
    } finally {
      loadingRef.current = false;
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void load(true);
    };
    const timer = window.setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return conversations.filter((conversation) => {
      const matchesStatus = status === "all" || conversation.status === status;
      const matchesQuery =
        !normalized ||
        [conversation.publicCode, conversation.subject, conversation.customerName]
          .join(" ")
          .toLocaleLowerCase("pt-BR")
          .includes(normalized);
      return matchesStatus && matchesQuery;
    });
  }, [conversations, query, status]);

  const selected = conversations.find((item) => item.id === selectedId) ?? null;
  const isManager = role === "gerencia";
  const isAdmin = role === "administracao";
  const canClaim = Boolean(selected && (isAdmin || isManager) && !selected.assignedName);
  const canReply = Boolean(selected && (selected.assignedToCurrentUser || isManager));
  const canManage = Boolean(selected && (selected.assignedToCurrentUser || isManager));
  const canAddInternal = canReply && (isAdmin || isManager);

  const update = async (body: Record<string, unknown>, success: string) => {
    if (processing) return false;
    setProcessing(String(body.action));
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${storeUrl()}/api/support`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = (await response.json()) as SupportResponse;
      if (!response.ok || !result.ok) {
        setError(result.message ?? "Não foi possível concluir a operação.");
        return false;
      }
      setConversations(result.conversations ?? []);
      setNotice(success);
      return true;
    } catch {
      setError("Conexão interrompida. A operação não foi concluída.");
      return false;
    } finally {
      setProcessing("");
    }
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || processing || !canReply) return;
    const form = new FormData(event.currentTarget);
    const message = replyText;
    const internal = form.get("internal") === "on";
    const file = form.get("file");
    setProcessing("message");
    setError("");
    setNotice("");
    try {
      const hasFile = file instanceof File && file.size > 0;
      const attachmentBody = new FormData();
      if (hasFile) {
        attachmentBody.set("conversationId", selected.id);
        attachmentBody.set("message", message);
        attachmentBody.set("internal", String(internal));
        attachmentBody.set("file", file);
      }
      const response = await fetch(
        `${storeUrl()}${hasFile ? "/api/support/attachments" : "/api/support"}`,
        {
          method: "POST",
          credentials: "include",
          ...(hasFile
            ? { body: attachmentBody }
            : {
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  action: "message",
                  conversationId: selected.id,
                  message,
                  internal
                })
              })
        }
      );
      const result = (await response.json()) as SupportResponse;
      if (!response.ok || !result.ok) {
        setError(result.message ?? "Não foi possível enviar a mensagem.");
        return;
      }
      if (hasFile) await load(true);
      else setConversations(result.conversations ?? []);
      setNotice(internal ? "Nota interna registrada." : "Resposta enviada ao cliente.");
      event.currentTarget.reset();
      setReplyText("");
    } catch {
      setError("Conexão interrompida. A mensagem não foi enviada.");
    } finally {
      setProcessing("");
    }
  };

  const transfer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || processing) return;
    const form = new FormData(event.currentTarget);
    const member = team.find((item) => item.id === form.get("target"));
    if (!member) {
      setError("Selecione um colaborador elegível.");
      return;
    }
    const done = await update(
      {
        action: "transfer",
        conversationId: selected.id,
        targetRole: member.role,
        targetUserId: member.demo ? undefined : member.id,
        reason: form.get("reason")
      },
      `Atendimento transferido para ${member.fullName}.`
    );
    if (done) setTransferOpen(false);
  };

  const closeConversation = async (conversationId: string) => {
    const accepted = await requestConfirm({
      title: "Encerrar atendimento?",
      description: "A conversa sai da fila ativa. Depois de encerrada, só a Gerência pode reabrir.",
      confirmLabel: "Encerrar atendimento"
    });
    if (!accepted) return;
    await update(
      {
        action: "status",
        conversationId,
        status: "closed",
        reason: "Atendimento encerrado após resolução"
      },
      "Atendimento encerrado."
    );
  };

  return (
    <div className="support-console" data-view={mobileView}>
      <section className="panel-card support-queue" aria-labelledby="support-queue-title">
        <header className="support-section-heading">
          <div>
            <h2 id="support-queue-title">Fila de atendimentos</h2>
            <p>
              {role === "operacional"
                ? "Somente chamados transferidos para você."
                : "Conversas autorizadas para seu perfil."}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => void load()}
            aria-label="Atualizar fila"
            title="Atualizar fila"
            disabled={loading}
          >
            <RefreshCw className={loading ? "spin" : ""} aria-hidden="true" />
          </button>
        </header>
        <div className="support-filters" role="search">
          <label>
            <span className="sr-only">Buscar chamado</span>
            <Search aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Código, assunto ou cliente"
            />
          </label>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
            aria-label="Filtrar por status"
          >
            {statusFilters.map((item) => (
              <option value={item.value} key={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        {!loading && conversations.length > 0 ? (
          <p className="support-count" aria-live="polite">
            <span className="ui-num">{filtered.length.toLocaleString("pt-BR")}</span>{" "}
            {filtered.length === 1 ? "atendimento" : "atendimentos"}
          </p>
        ) : null}
        {loading ? (
          <div className="ui-loading support-loading" role="status" aria-live="polite">
            <span className="sr-only">Carregando fila…</span>
            <span className="ui-skeleton" aria-hidden="true" />
            <span className="ui-skeleton" aria-hidden="true" />
            <span className="ui-skeleton" aria-hidden="true" />
          </div>
        ) : error && conversations.length === 0 ? (
          <StateMessage
            kind="error"
            compact
            level={3}
            icon={AlertTriangle}
            title="Fila indisponível"
            description={error}
            action={
              <button className="secondary-button" type="button" onClick={() => void load()}>
                <RefreshCw aria-hidden="true" /> Tentar novamente
              </button>
            }
          />
        ) : filtered.length === 0 ? (
          <StateMessage
            compact
            level={3}
            icon={Inbox}
            title="Nenhum atendimento encontrado"
            description={
              conversations.length
                ? "Nenhuma conversa corresponde à busca ou ao status escolhido."
                : "A fila será atualizada automaticamente."
            }
          />
        ) : (
          <nav className="conversation-list" aria-label="Atendimentos">
            {filtered.map((conversation) => (
              <button
                className={conversation.id === selectedId ? "active" : ""}
                key={conversation.id}
                type="button"
                aria-current={conversation.id === selectedId ? "true" : undefined}
                onClick={() => {
                  setSelectedId(conversation.id);
                  setMobileView("conversation");
                }}
              >
                <span>
                  <strong>{conversation.subject}</strong>
                  <small>
                    <Code>{conversation.publicCode}</Code> · {conversation.customerName}
                  </small>
                </span>
                <StatusLabel tone={statusTones[conversation.status] ?? "neutral"}>
                  {supportStatusLabels[conversation.status]}
                </StatusLabel>
              </button>
            ))}
          </nav>
        )}
      </section>

      <section className="panel-card support-workspace" aria-label="Conversa selecionada">
        <button className="ghost-button support-back" type="button" onClick={() => setMobileView("list")}>
          <ArrowLeft aria-hidden="true" /> Voltar à fila
        </button>
        {!selected ? (
          <StateMessage
            compact
            level={3}
            icon={Inbox}
            title="Selecione um atendimento"
            description="As mensagens e ações aparecerão aqui."
          />
        ) : (
          <>
            <header className="support-conversation-heading">
              <div className="support-conversation-title">
                <div className="support-conversation-tags">
                  <Code>{selected.publicCode}</Code>
                  <StatusLabel tone={statusTones[selected.status] ?? "neutral"}>
                    {supportStatusLabels[selected.status]}
                  </StatusLabel>
                  {selected.priority === "high" || selected.priority === "urgent" ? (
                    <StatusLabel tone={selected.priority === "urgent" ? "danger" : "warning"}>
                      Prioridade {priorityLabels[selected.priority]?.toLowerCase()}
                    </StatusLabel>
                  ) : null}
                </div>
                <h2>{selected.subject}</h2>
                <p>
                  {selected.customerName}
                  {selected.relatedOrderCode ? (
                    <>
                      {" · Pedido "}
                      <Code>{selected.relatedOrderCode}</Code>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="support-owner-row">
                <span>
                  {selected.assignedName
                    ? `Responsável: ${selected.assignedName}`
                    : "Aguardando responsável"}
                </span>
                {canClaim && (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={Boolean(processing)}
                    onClick={() =>
                      void update(
                        { action: "claim", conversationId: selected.id },
                        "Atendimento assumido com sucesso."
                      )
                    }
                  >
                    {processing === "claim" ? <LoaderCircle className="spin" aria-hidden="true" /> : <UserRoundCheck aria-hidden="true" />}{" "}
                    Assumir
                  </button>
                )}
              </div>
              {canManage && (
                <div className="support-actions">
                  <label>
                    Prioridade
                    <select
                      value={selected.priority}
                      onChange={(event) => {
                        const next = event.target.value;
                        void (async () => {
                          const reason = await requestPrompt({
                            title: "Alterar prioridade",
                            label: "Motivo da alteração",
                            minLength: 3
                          });
                          if (reason)
                            await update(
                              {
                                action: "priority",
                                conversationId: selected.id,
                                priority: next,
                                reason
                              },
                              "Prioridade atualizada."
                            );
                        })();
                      }}
                    >
                      <option value="low">Baixa</option>
                      <option value="normal">Normal</option>
                      <option value="high">Alta</option>
                      <option value="urgent">Urgente</option>
                    </select>
                  </label>
                  <div className="support-action-buttons">
                    {(isAdmin || isManager) && team.length > 0 && (
                      <button
                        className="secondary-button"
                        type="button"
                        aria-expanded={transferOpen}
                        onClick={() => setTransferOpen((current) => !current)}
                      >
                        <ArrowUpRight aria-hidden="true" /> Transferir
                      </button>
                    )}
                    {!(["resolved", "closed"] as SupportStatus[]).includes(selected.status) && (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={Boolean(processing)}
                        onClick={() =>
                          void update(
                            {
                              action: "status",
                              conversationId: selected.id,
                              status: "resolved",
                              reason: "Solicitação concluída pela equipe"
                            },
                            "Atendimento marcado como resolvido."
                          )
                        }
                      >
                        <CircleCheck aria-hidden="true" /> Resolver
                      </button>
                    )}
                    {selected.status === "resolved" && (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={Boolean(processing)}
                        onClick={() => void closeConversation(selected.id)}
                      >
                        Encerrar
                      </button>
                    )}
                    {selected.status === "closed" && isManager && (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={Boolean(processing)}
                        onClick={() =>
                          void update(
                            {
                              action: "status",
                              conversationId: selected.id,
                              status: "reopened",
                              reason: "Atendimento reaberto pela Gerência"
                            },
                            "Atendimento reaberto."
                          )
                        }
                      >
                        Reabrir
                      </button>
                    )}
                  </div>
                </div>
              )}
            </header>
            {transferOpen && (
              <form className="support-transfer-form" onSubmit={(event) => void transfer(event)}>
                <h3>Transferir atendimento</h3>
                <label>
                  Colaborador
                  <select name="target" required defaultValue="">
                    <option value="" disabled>
                      Selecione
                    </option>
                    {team.map((member) => (
                      <option value={member.id} key={member.id}>
                        {member.fullName} · {roleLabels[member.role]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Motivo
                  <textarea name="reason" required minLength={10} maxLength={500} />
                  <small>Mínimo de 10 caracteres.</small>
                </label>
                <div className="support-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setTransferOpen(false)}
                  >
                    Cancelar
                  </button>
                  <button className="primary-button" type="submit" disabled={Boolean(processing)}>
                    {processing === "transfer" ? (
                      <LoaderCircle className="spin" aria-hidden="true" />
                    ) : (
                      <ArrowUpRight aria-hidden="true" />
                    )}{" "}
                    Confirmar transferência
                  </button>
                </div>
              </form>
            )}
            {error && (
              <p className="admin-feedback error support-feedback" role="alert">
                <AlertTriangle aria-hidden="true" /> <span>{error}</span>
              </p>
            )}
            {notice && (
              <p className="admin-feedback success support-feedback" role="status">
                <CircleCheck aria-hidden="true" /> <span>{notice}</span>
              </p>
            )}
            <div className="message-thread" aria-live="polite" tabIndex={0} aria-label="Mensagens do atendimento">
              {selected.messages.map((message) => (
                <article className={`message ${message.author}`} key={message.id}>
                  <header className="support-message-meta">
                    {message.author === "internal" ? (
                      <StatusLabel tone="neutral">Nota interna</StatusLabel>
                    ) : (
                      <strong>{message.author === "customer" ? selected.customerName : "Equipe"}</strong>
                    )}
                    <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
                  </header>
                  <p>{message.content}</p>
                  {message.attachments?.map((attachment) =>
                    attachment.available && attachment.url ? (
                      <a href={attachment.url?.startsWith("/") ? `${storeUrl()}${attachment.url}` : attachment.url} target="_blank" rel="noreferrer" key={attachment.id}>
                        <FileText aria-hidden="true" />
                        {attachment.name}
                      </a>
                    ) : (
                      <span key={attachment.id}>
                        <FileText aria-hidden="true" />
                        {attachment.name} · em verificação
                      </span>
                    )
                  )}
                </article>
              ))}
            </div>
            {canReply ? (
              <form className="support-reply-form" onSubmit={(event) => void sendMessage(event)}>
                <div className="support-reply-heading">
                  <label htmlFor="support-reply">Responder</label>
                  {quickReplies.length > 0 && (
                    <select
                      aria-label="Inserir resposta rápida"
                      defaultValue=""
                      onChange={(event) => {
                        const selectedReply = quickReplies.find(
                          (item) => item.id === event.target.value
                        );
                        if (selectedReply) setReplyText(selectedReply.content);
                        event.target.value = "";
                      }}
                    >
                      <option value="">Usar resposta rápida…</option>
                      {quickReplies.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.shortcut} · {item.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <textarea
                  id="support-reply"
                  name="message"
                  required
                  maxLength={4000}
                  value={replyText}
                  onChange={(event) => setReplyText(event.target.value)}
                  placeholder="Escreva uma resposta objetiva e segura."
                />
                <div className="support-reply-options">
                  <label className="support-file-field">
                    <Paperclip aria-hidden="true" /> Anexo opcional
                    <input
                      name="file"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                    />
                    <small>JPG, PNG, WebP ou PDF de até 10 MB.</small>
                  </label>
                  {canAddInternal && (
                    <label className="support-internal-toggle">
                      <input type="checkbox" name="internal" /> Registrar como nota interna (invisível
                      ao cliente)
                    </label>
                  )}
                </div>
                <button className="primary-button" type="submit" disabled={Boolean(processing)}>
                  {processing === "message" ? <LoaderCircle className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />}{" "}
                  {processing === "message" ? "Enviando…" : "Enviar"}
                </button>
              </form>
            ) : (
              <p className="admin-feedback info support-feedback">
                Assuma o atendimento ou aguarde uma transferência para responder.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
