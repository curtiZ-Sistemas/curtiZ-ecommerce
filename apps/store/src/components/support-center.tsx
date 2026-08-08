"use client";

import {
  supportCategories,
  supportCategoryLabels,
  supportStatusLabels,
  type SupportConversationView
} from "@curtiz/domain";
import { createBrowserClient } from "@supabase/ssr";
import {
  FileText,
  LoaderCircle,
  MessageCircle,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Star
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

type SupportResponse = {
  ok: boolean;
  conversations?: SupportConversationView[];
  conversation?: SupportConversationView;
  message?: string;
  requiresAuthentication?: boolean;
};

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));

const waitingStatuses = new Set(["open", "queued", "reopened"]);

export function SupportCenter({ startNew = false }: { startNew?: boolean }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [conversations, setConversations] = useState<SupportConversationView[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [formOpen, setFormOpen] = useState(startNew);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [rated, setRated] = useState<Record<string, boolean>>({});
  const requestIdRef = useRef(crypto.randomUUID());

  const loadConversations = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/support", { cache: "no-store", credentials: "include" });
      const result = (await response.json()) as SupportResponse;
      if (response.status === 401 || result.requiresAuthentication) {
        setAuthenticated(false);
        setConversations([]);
        return;
      }
      if (!response.ok || !result.ok) throw new Error("support_load_failed");
      setAuthenticated(true);
      setConversations(result.conversations ?? []);
      setSelectedId((current) => current || result.conversations?.[0]?.id || "");
      setMessage("");
    } catch {
      setMessage(
        "Não foi possível carregar os atendimentos. Verifique a conexão e tente novamente."
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!authenticated) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (url && key) {
      const supabase = createBrowserClient(url, key);
      const channel = supabase
        .channel("customer-support-updates")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "support_conversations" },
          () => void loadConversations(true)
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "support_messages" },
          () => void loadConversations(true)
        )
        .subscribe();
      return () => {
        void supabase.removeChannel(channel);
      };
    }
    const fallback = window.setInterval(() => void loadConversations(true), 30_000);
    return () => window.clearInterval(fallback);
  }, [authenticated, loadConversations]);

  const requireCustomerAccount = () => {
    if (authenticated) {
      setFormOpen(true);
      return;
    }
    const returnTo = "/minha-conta/atendimento?new=1";
    window.location.assign(`/login?next=${encodeURIComponent(returnTo)}`);
  };

  const createConversation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const formElement = event.currentTarget;
    setSubmitting(true);
    setMessage("");
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          category: form.get("category"),
          subject: form.get("subject"),
          message: form.get("message"),
          orderCode: form.get("orderCode") || undefined,
          requestId: requestIdRef.current
        })
      });
      const result = (await response.json()) as SupportResponse;
      if (response.status === 401) {
        requireCustomerAccount();
        return;
      }
      if (!response.ok || !result.ok || !result.conversation) {
        setMessage(result.message ?? "Não foi possível criar o atendimento.");
        return;
      }
      setConversations((current) => [
        result.conversation!,
        ...current.filter((item) => item.id !== result.conversation?.id)
      ]);
      setSelectedId(result.conversation.id);
      setFormOpen(false);
      setMessage(result.message ?? "Chamado enviado com sucesso.");
      requestIdRef.current = crypto.randomUUID();
      formElement.reset();
    } catch {
      setMessage("Não foi possível conectar ao atendimento. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !selectedId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const content = form.get("message");
    const contentText = typeof content === "string" ? content : "";
    const file = form.get("file");
    setSubmitting(true);
    setMessage("");
    try {
      const hasFile = file instanceof File && file.size > 0;
      const attachmentBody = new FormData();
      if (hasFile) {
        attachmentBody.set("conversationId", selectedId);
        attachmentBody.set("message", contentText);
        attachmentBody.set("internal", "false");
        attachmentBody.set("file", file);
      }
      const response = await fetch(hasFile ? "/api/support/attachments" : "/api/support", {
        method: "POST",
        credentials: "include",
        ...(hasFile
          ? { body: attachmentBody }
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "message",
                conversationId: selectedId,
                message: contentText,
                internal: false
              })
            })
      });
      const result = (await response.json()) as SupportResponse;
      if (!response.ok || !result.ok) {
        setMessage(result.message ?? "Não foi possível enviar a mensagem.");
        return;
      }
      if (hasFile) await loadConversations(true);
      else setConversations(result.conversations ?? []);
      formElement.reset();
    } catch {
      setMessage("Conexão interrompida. Sua mensagem não foi enviada; tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  const reopen = async (conversationId: string) => {
    const reason = window.prompt("Explique por que o atendimento precisa ser reaberto:");
    if (!reason) return;
    setSubmitting(true);
    const response = await fetch("/api/support", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reopen", conversationId, reason })
    });
    const result = (await response.json()) as SupportResponse;
    setSubmitting(false);
    if (!response.ok || !result.ok) setMessage(result.message ?? "Não foi possível reabrir.");
    else setConversations(result.conversations ?? []);
  };

  const rate = async (conversationId: string, rating: number) => {
    if (rated[conversationId]) return;
    setRated((current) => ({ ...current, [conversationId]: true }));
    const response = await fetch("/api/support", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "rate", conversationId, rating, resolved: rating >= 3 })
    });
    if (!response.ok) {
      setRated((current) => ({ ...current, [conversationId]: false }));
      setMessage("Não foi possível registrar a avaliação.");
    }
  };

  const selected = conversations.find((item) => item.id === selectedId) ?? null;

  return (
    <>
      {authenticated !== null && (
        <section className="customer-support" aria-labelledby="customer-support-title">
          <header className="customer-support-heading">
            <div>
              <p className="eyebrow">Atendimento ao cliente</p>
              <h2 id="customer-support-title">Seus chamados</h2>
              <p>Converse com a equipe e acompanhe cada atualização.</p>
            </div>
            <button className="primary-button" type="button" onClick={requireCustomerAccount}>
              <Plus size={17} /> Novo chamado
            </button>
          </header>

          {message && (
            <p className="form-message" role="status">
              {message}
            </p>
          )}
          {loading ? (
            <div className="support-loading" aria-label="Carregando atendimentos">
              <LoaderCircle className="spin" /> Carregando atendimentos…
            </div>
          ) : formOpen ? (
            <SupportForm
              submitting={submitting}
              onSubmit={(event) => void createConversation(event)}
              onCancel={() => setFormOpen(false)}
            />
          ) : conversations.length === 0 ? (
            <div className="empty-state compact-empty-state">
              <MessageCircle />
              <h3>Nenhum chamado aberto</h3>
              <p>Quando precisar, abra um atendimento e acompanhe tudo por aqui.</p>
              <button className="primary-button" type="button" onClick={requireCustomerAccount}>
                Abrir primeiro chamado
              </button>
            </div>
          ) : (
            <div className="customer-support-layout">
              <nav className="customer-ticket-list" aria-label="Meus chamados">
                {conversations.map((conversation) => (
                  <button
                    type="button"
                    className={conversation.id === selectedId ? "active" : ""}
                    key={conversation.id}
                    onClick={() => setSelectedId(conversation.id)}
                  >
                    <span>
                      <strong>{conversation.subject}</strong>
                      <small>{conversation.publicCode}</small>
                    </span>
                    <span className="status-pill">{supportStatusLabels[conversation.status]}</span>
                  </button>
                ))}
              </nav>
              {selected && (
                <article className="customer-thread">
                  <header>
                    <div>
                      <h3>{selected.subject}</h3>
                      <p>
                        {selected.publicCode} · {supportCategoryLabels[selected.category]}
                      </p>
                    </div>
                    <span className="status-pill">{supportStatusLabels[selected.status]}</span>
                  </header>
                  {waitingStatuses.has(selected.status) && !selected.assignedName && (
                    <p className="support-waiting-message" role="status">
                      Seu chamado foi enviado e aguarda atendimento da equipe.
                    </p>
                  )}
                  {selected.assignedName && (
                    <p className="support-assigned-message">
                      Atendimento assumido pela equipe Curtiz.
                    </p>
                  )}
                  <div className="customer-message-thread" aria-live="polite">
                    {selected.messages.map((item) => (
                      <div className={`customer-message ${item.author}`} key={item.id}>
                        <p>{item.content}</p>
                        {item.attachments?.map((attachment) =>
                          attachment.available && attachment.url ? (
                            <a
                              href={attachment.url}
                              target="_blank"
                              rel="noreferrer"
                              key={attachment.id}
                            >
                              <FileText /> {attachment.name}
                            </a>
                          ) : (
                            <span className="support-attachment-pending" key={attachment.id}>
                              <FileText /> {attachment.name} · aguardando verificação
                            </span>
                          )
                        )}
                        <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                      </div>
                    ))}
                  </div>
                  {!(["closed", "cancelled", "spam"] as string[]).includes(selected.status) && (
                    <form className="customer-reply" onSubmit={(event) => void sendMessage(event)}>
                      <label htmlFor="customer-support-message">Nova mensagem</label>
                      <textarea
                        id="customer-support-message"
                        name="message"
                        required
                        minLength={1}
                        maxLength={4000}
                        placeholder="Escreva sua mensagem sem incluir senhas ou dados de cartão."
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
                      <button className="primary-button" disabled={submitting}>
                        {submitting ? <LoaderCircle className="spin" /> : <Send size={17} />}
                        {submitting ? "Enviando…" : "Enviar mensagem"}
                      </button>
                    </form>
                  )}
                  {(["resolved", "closed"] as string[]).includes(selected.status) && (
                    <div className="support-resolution-actions">
                      <div>
                        <strong>Avalie este atendimento</strong>
                        {[1, 2, 3, 4, 5].map((value) => (
                          <button
                            type="button"
                            key={value}
                            disabled={rated[selected.id]}
                            onClick={() => void rate(selected.id, value)}
                            aria-label={`${value} estrela${value === 1 ? "" : "s"}`}
                          >
                            <Star />
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={submitting}
                        onClick={() => void reopen(selected.id)}
                      >
                        <RotateCcw /> Reabrir atendimento
                      </button>
                    </div>
                  )}
                </article>
              )}
            </div>
          )}
          {!loading && (
            <button
              className="text-link support-refresh"
              type="button"
              onClick={() => void loadConversations()}
            >
              <RefreshCw size={15} /> Atualizar chamados
            </button>
          )}
        </section>
      )}
    </>
  );
}

function SupportForm({
  submitting,
  onSubmit,
  onCancel
}: {
  submitting: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <form className="form-stack support-form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="support-category">Categoria</label>
        <select id="support-category" name="category" required defaultValue="order">
          {supportCategories.map((category) => (
            <option value={category} key={category}>
              {supportCategoryLabels[category]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="support-order">
          Número do pedido <span className="optional-label">opcional</span>
        </label>
        <input id="support-order" name="orderCode" maxLength={40} placeholder="Ex.: CZT-…" />
      </div>
      <div className="field">
        <label htmlFor="support-subject">Assunto</label>
        <input id="support-subject" name="subject" required minLength={5} maxLength={120} />
      </div>
      <div className="field">
        <label htmlFor="support-message">Mensagem inicial</label>
        <textarea id="support-message" name="message" required minLength={10} maxLength={4000} />
      </div>
      <p className="chat-warning">
        Nunca envie senhas, códigos de segurança, número completo de cartão ou CVV.
      </p>
      <div className="option-row">
        <button className="secondary-button" type="button" onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
        <button className="primary-button" disabled={submitting}>
          {submitting ? <LoaderCircle className="spin" /> : <Send size={18} />}
          {submitting ? "Enviando…" : "Enviar para a equipe"}
        </button>
      </div>
    </form>
  );
}
