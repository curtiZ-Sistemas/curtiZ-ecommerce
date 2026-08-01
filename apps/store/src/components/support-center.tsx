"use client";

import {
  supportCategories,
  supportCategoryLabels,
  supportStatusLabels,
  type SupportConversationView
} from "@curtiz/domain";
import { createBrowserClient } from "@supabase/ssr";
import {
  CircleCheck,
  Headphones,
  LoaderCircle,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  X
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

const quickAnswers = [
  {
    question: "Como funciona o frete?",
    answer:
      "O valor e o prazo são calculados pelo CEP na página do produto, no carrinho ou no checkout. O prazo começa após a confirmação do pagamento.",
    action: "Ver formas de envio",
    href: "/formas-de-envio"
  },
  {
    question: "Como rastrear meu pedido?",
    answer:
      "Acesse Minha conta › Pedidos e selecione a compra. Quando houver rastreio, os eventos e a previsão atualizada aparecerão na linha do tempo.",
    action: "Consultar pedido",
    href: "/minha-conta/pedidos"
  },
  {
    question: "Meu pagamento foi aprovado?",
    answer:
      "O status exibido na sua conta vem da confirmação do servidor. A página de retorno do pagamento, sozinha, nunca altera o pedido para pago.",
    action: "Ver meus pedidos",
    href: "/minha-conta/pedidos"
  },
  {
    question: "Como solicitar uma troca?",
    answer:
      "Na página do pedido, escolha o item e toque em Solicitar troca. O sistema verificará prazo, quantidade e necessidade de fotos.",
    action: "Ver política de trocas",
    href: "/trocas-e-devolucoes"
  }
] as const;

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

export function SupportCenter({
  accountMode = false,
  startNew = false
}: {
  accountMode?: boolean;
  startNew?: boolean;
}) {
  const [selectedAnswer, setSelectedAnswer] = useState<(typeof quickAnswers)[number] | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [conversations, setConversations] = useState<SupportConversationView[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [formOpen, setFormOpen] = useState(startNew);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
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
      setMessage("Não foi possível carregar os atendimentos. Verifique a conexão e tente novamente.");
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
    setSubmitting(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
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
      event.currentTarget.reset();
    } catch {
      setMessage("Não foi possível conectar ao atendimento. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !selectedId) return;
    const form = new FormData(event.currentTarget);
    const content = form.get("message");
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "message",
          conversationId: selectedId,
          message: content,
          internal: false
        })
      });
      const result = (await response.json()) as SupportResponse;
      if (!response.ok || !result.ok) {
        setMessage(result.message ?? "Não foi possível enviar a mensagem.");
        return;
      }
      setConversations(result.conversations ?? []);
      event.currentTarget.reset();
    } catch {
      setMessage("Conexão interrompida. Sua mensagem não foi enviada; tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  const selected = conversations.find((item) => item.id === selectedId) ?? null;

  return (
    <>
      {!accountMode && (
        <>
          <div className="help-grid">
            {quickAnswers.map((item) => (
              <button
                className="help-card"
                type="button"
                key={item.question}
                onClick={() => setSelectedAnswer(item)}
              >
                <strong>{item.question}</strong>
                <p>Ver resposta e ações relacionadas →</p>
              </button>
            ))}
          </div>
          {selectedAnswer && (
            <section className="help-answer" aria-live="polite">
              <button
                className="help-answer-close"
                type="button"
                onClick={() => setSelectedAnswer(null)}
                aria-label="Fechar resposta"
              >
                <X />
              </button>
              <p className="eyebrow">Resposta rápida</p>
              <h2>{selectedAnswer.question}</h2>
              <p>{selectedAnswer.answer}</p>
              <div className="option-row">
                <Link className="secondary-button" href={selectedAnswer.href}>
                  <CircleCheck size={18} /> {selectedAnswer.action}
                </Link>
                <button className="primary-button" type="button" onClick={requireCustomerAccount}>
                  <Headphones size={18} /> Falar com um humano
                </button>
              </div>
            </section>
          )}
          {!selectedAnswer && (
            <button className="primary-button support-human-cta" type="button" onClick={requireCustomerAccount}>
              <Headphones size={18} /> Falar com atendimento humano
            </button>
          )}
        </>
      )}

      {(accountMode || authenticated) && (
        <section className="customer-support" aria-labelledby="customer-support-title">
          <header className="customer-support-heading">
            <div>
              <p className="eyebrow">Atendimento ao cliente</p>
              <h2 id="customer-support-title">Seus chamados</h2>
              <p>Converse com a equipe e acompanhe cada atualização.</p>
            </div>
            <button className="primary-button" type="button" onClick={() => setFormOpen(true)}>
              <Plus size={17} /> Novo chamado
            </button>
          </header>

          {message && <p className="form-message" role="status">{message}</p>}
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
              <button className="primary-button" type="button" onClick={() => setFormOpen(true)}>
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
                      <p>{selected.publicCode} · {supportCategoryLabels[selected.category]}</p>
                    </div>
                    <span className="status-pill">{supportStatusLabels[selected.status]}</span>
                  </header>
                  {waitingStatuses.has(selected.status) && !selected.assignedName && (
                    <p className="support-waiting-message" role="status">
                      Seu chamado foi enviado. Nosso atendimento humano pode levar de 1 a 3 horas
                      para responder.
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
                      <button className="primary-button" disabled={submitting}>
                        {submitting ? <LoaderCircle className="spin" /> : <Send size={17} />}
                        {submitting ? "Enviando…" : "Enviar mensagem"}
                      </button>
                    </form>
                  )}
                </article>
              )}
            </div>
          )}
          {!loading && (
            <button className="text-link support-refresh" type="button" onClick={() => void loadConversations()}>
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
            <option value={category} key={category}>{supportCategoryLabels[category]}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="support-order">Número do pedido <span className="optional-label">opcional</span></label>
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
