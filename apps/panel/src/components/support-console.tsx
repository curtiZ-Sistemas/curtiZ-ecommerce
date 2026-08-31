"use client";

import { resolvePublicAppUrls } from "@curtiz/config";

import {
  supportStatusLabels,
  type SupportConversationView,
  type SupportStatus,
  type SupportTeamMember
} from "@curtiz/domain";
import { createBrowserClient } from "@supabase/ssr";
import {
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
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { usePanelPrompt } from "./panel-prompt";

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

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));

export function SupportConsole({ role }: { role: PanelRole }) {
  const requestPrompt = usePanelPrompt();
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

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`${storeUrl()}/api/support`, {
        cache: "no-store",
        credentials: "include"
      });
      const result = (await response.json()) as SupportResponse;
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
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (url && key) {
      const supabase = createBrowserClient(url, key);
      const channel = supabase
        .channel("panel-support-updates")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "support_conversations" },
          () => void load(true)
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "support_messages" },
          () => void load(true)
        )
        .subscribe();
      return () => {
        void supabase.removeChannel(channel);
      };
    }
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
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

  return (
    <div className="support-console">
      <section className="panel-card support-queue">
        <header className="support-section-heading">
          <div>
            <h2>Fila de atendimentos</h2>
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
            disabled={loading}
          >
            <RefreshCw className={loading ? "spin" : ""} />
          </button>
        </header>
        <div className="support-filters">
          <label>
            <span className="sr-only">Buscar chamado</span>
            <Search />
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
        {loading ? (
          <div className="support-state">
            <LoaderCircle className="spin" /> Carregando fila…
          </div>
        ) : error && conversations.length === 0 ? (
          <div className="support-state support-error">
            <p>{error}</p>
            <button className="secondary-button" onClick={() => void load()}>
              Tentar novamente
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="support-state">
            <Inbox />
            <strong>Nenhum atendimento encontrado</strong>
            <span>A fila será atualizada automaticamente.</span>
          </div>
        ) : (
          <nav className="conversation-list" aria-label="Atendimentos">
            {filtered.map((conversation) => (
              <button
                className={conversation.id === selectedId ? "active" : ""}
                key={conversation.id}
                onClick={() => setSelectedId(conversation.id)}
              >
                <span>
                  <strong>{conversation.subject}</strong>
                  <small>
                    {conversation.publicCode} · {conversation.customerName}
                  </small>
                </span>
                <span className={`status ${conversation.status}`}>
                  {supportStatusLabels[conversation.status]}
                </span>
              </button>
            ))}
          </nav>
        )}
      </section>

      <section className="panel-card support-workspace">
        {!selected ? (
          <div className="support-state">
            <Inbox />
            <strong>Selecione um atendimento</strong>
            <span>As mensagens e ações aparecerão aqui.</span>
          </div>
        ) : (
          <>
            <header className="support-conversation-heading">
              <div>
                <p className="eyebrow">{selected.publicCode}</p>
                <h2>{selected.subject}</h2>
                <p>
                  {selected.customerName}
                  {selected.relatedOrderCode ? ` · ${selected.relatedOrderCode}` : ""}
                </p>
              </div>
              <span className={`status ${selected.status}`}>
                {supportStatusLabels[selected.status]}
              </span>
            </header>
            {error && (
              <p className="support-feedback error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="support-feedback success" role="status">
                <CircleCheck /> {notice}
              </p>
            )}
            <div className="support-owner-row">
              <span>
                {selected.assignedName
                  ? `Responsável: ${selected.assignedName}`
                  : "Aguardando responsável"}
              </span>
              {canClaim && (
                <button
                  className="secondary-button"
                  disabled={Boolean(processing)}
                  onClick={() =>
                    void update(
                      { action: "claim", conversationId: selected.id },
                      "Atendimento assumido com sucesso."
                    )
                  }
                >
                  {processing === "claim" ? <LoaderCircle className="spin" /> : <UserRoundCheck />}{" "}
                  Assumir
                </button>
              )}
            </div>
            <div className="message-thread" aria-live="polite">
              {selected.messages.map((message) => (
                <article className={`message ${message.author}`} key={message.id}>
                  <p>{message.content}</p>
                  {message.attachments?.map((attachment) =>
                    attachment.available && attachment.url ? (
                      <a href={attachment.url} target="_blank" rel="noreferrer" key={attachment.id}>
                        <FileText />
                        {attachment.name}
                      </a>
                    ) : (
                      <span key={attachment.id}>
                        <FileText />
                        {attachment.name} · em verificação
                      </span>
                    )
                  )}
                  <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
                </article>
              ))}
            </div>
            {canReply ? (
              <form className="support-reply-form" onSubmit={(event) => void sendMessage(event)}>
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
                <textarea
                  id="support-reply"
                  name="message"
                  required
                  maxLength={4000}
                  value={replyText}
                  onChange={(event) => setReplyText(event.target.value)}
                  placeholder="Escreva uma resposta objetiva e segura."
                />
                <label className="support-file-field">
                  <Paperclip /> Anexo opcional
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
                <button className="primary-button" disabled={Boolean(processing)}>
                  {processing === "message" ? <LoaderCircle className="spin" /> : <Send />}{" "}
                  {processing === "message" ? "Enviando…" : "Enviar"}
                </button>
              </form>
            ) : (
              <p className="support-feedback">
                Assuma o atendimento ou aguarde uma transferência para responder.
              </p>
            )}
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
                {(isAdmin || isManager) && team.length > 0 && (
                  <button
                    className="secondary-button"
                    onClick={() => setTransferOpen((current) => !current)}
                  >
                    <ArrowUpRight /> Transferir
                  </button>
                )}
                {!(["resolved", "closed"] as SupportStatus[]).includes(selected.status) && (
                  <button
                    className="secondary-button"
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
                    <CircleCheck /> Resolver
                  </button>
                )}
                {selected.status === "resolved" && (
                  <button
                    className="secondary-button"
                    disabled={Boolean(processing)}
                    onClick={() =>
                      void update(
                        {
                          action: "status",
                          conversationId: selected.id,
                          status: "closed",
                          reason: "Atendimento encerrado após resolução"
                        },
                        "Atendimento encerrado."
                      )
                    }
                  >
                    Encerrar
                  </button>
                )}
                {selected.status === "closed" && isManager && (
                  <button
                    className="secondary-button"
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
            )}
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
                </label>
                <div className="support-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setTransferOpen(false)}
                  >
                    Cancelar
                  </button>
                  <button className="primary-button" disabled={Boolean(processing)}>
                    {processing === "transfer" ? (
                      <LoaderCircle className="spin" />
                    ) : (
                      <ArrowUpRight />
                    )}{" "}
                    Confirmar transferência
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </section>
    </div>
  );
}
