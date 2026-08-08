"use client";

import { Bot, ChevronDown, Headphones, LoaderCircle, MessageCircle, Send, X } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { HelpContent } from "@/lib/help-content";
import { localHelpReply } from "@/lib/help-intents";

type ChatMessage = {
  id: number;
  author: "assistant" | "customer";
  text: string;
  source?: Pick<HelpContent, "title" | "slug" | "updatedAt">;
  action?: { label: string; href: string };
};

type HelpResponse = { ok: boolean; contents?: HelpContent[] };

const initialMessage: ChatMessage = {
  id: 1,
  author: "assistant",
  text: "Olá! Como podemos ajudar?"
};

const safeFallback =
  "Não encontrei uma resposta segura para essa situação. Posso encaminhar você para o atendimento.";

const quickActions = [
  "Rastrear pedido",
  "Problema com entrega",
  "Troca ou devolução",
  "Pagamento",
  "Produto",
  "Minha conta",
  "Avaliação",
  "Representante Curtiz"
] as const;

function restoreHistory(): ChatMessage[] {
  try {
    const stored = sessionStorage.getItem("curtiz-help-chat");
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    return Array.isArray(parsed) && parsed.length
      ? (parsed as ChatMessage[]).slice(-30)
      : [initialMessage];
  } catch {
    return [initialMessage];
  }
}

export function HelpChat() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [typing, setTyping] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMessages(restoreHistory()), []);
  useEffect(() => {
    sessionStorage.setItem("curtiz-help-chat", JSON.stringify(messages.slice(-30)));
  }, [messages]);
  useEffect(() => {
    if (open && !minimized) inputRef.current?.focus();
  }, [minimized, open]);
  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        setOpen(false);
        setMinimized(false);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);

  const close = () => {
    setOpen(false);
    setMinimized(false);
    setTyping(false);
  };

  const ask = useCallback(
    async (text: string) => {
      if (typing || !text.trim()) return;
      const nextId = Date.now();
      setMessages((current) => [...current, { id: nextId, author: "customer", text: text.trim() }]);
      setTyping(true);
      const localReply = localHelpReply(text);
      if (localReply) {
        setMessages((current) => [
          ...current,
          { id: nextId + 1, author: "assistant", ...localReply }
        ]);
        setTyping(false);
        return;
      }
      try {
        const params = new URLSearchParams({ q: text.trim().slice(0, 160), origin: "chat" });
        const response = await fetch(`/api/help?${params}`, { cache: "no-store" });
        const result = (await response.json()) as HelpResponse;
        const source = response.ok && result.ok ? result.contents?.[0] : undefined;
        setMessages((current) => [
          ...current,
          source
            ? {
                id: nextId + 1,
                author: "assistant",
                text: source.body.length > 420 ? `${source.body.slice(0, 417)}…` : source.body,
                source: { title: source.title, slug: source.slug, updatedAt: source.updatedAt }
              }
            : { id: nextId + 1, author: "assistant", text: safeFallback }
        ]);
      } catch {
        setMessages((current) => [
          ...current,
          { id: nextId + 1, author: "assistant", text: safeFallback }
        ]);
      } finally {
        setTyping(false);
      }
    },
    [typing]
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rawMessage = form.get("message");
    const text = typeof rawMessage === "string" ? rawMessage.trim() : "";
    if (!text) return;
    event.currentTarget.reset();
    void ask(text);
  };

  return (
    <div className="help-widget">
      {open && (
        <section
          className={minimized ? "help-chat-window is-minimized" : "help-chat-window"}
          role="dialog"
          aria-modal="false"
          aria-labelledby="help-chat-title"
        >
          <header className="help-chat-header">
            <div className="help-chat-avatar" aria-hidden="true">
              <Headphones />
            </div>
            <div>
              <strong id="help-chat-title">Ajuda Curtiz</strong>
              <span>
                <i /> Conteúdo publicado
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMinimized((current) => !current)}
              aria-label={minimized ? "Expandir conversa" : "Minimizar conversa"}
            >
              <ChevronDown className={minimized ? "rotate-up" : ""} />
            </button>
            <button type="button" onClick={close} aria-label="Fechar conversa">
              <X />
            </button>
          </header>

          {!minimized && (
            <>
              <div className="help-chat-messages" ref={messagesRef} aria-live="polite">
                {messages.map((message) => (
                  <div className={`chat-message ${message.author}`} key={message.id}>
                    {message.author === "assistant" && <Bot aria-hidden="true" />}
                    <div>
                      <p>{message.text}</p>
                      {message.source && (
                        <Link
                          href={`/ajuda?q=${encodeURIComponent(message.source.title)}`}
                          onClick={close}
                        >
                          Fonte: {message.source.title} · atualizado em{" "}
                          {new Intl.DateTimeFormat("pt-BR", {
                            timeZone: "America/Sao_Paulo"
                          }).format(new Date(message.source.updatedAt))}
                        </Link>
                      )}
                      {message.action && (
                        <Link href={message.action.href} onClick={close}>
                          {message.action.label}
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
                {typing && (
                  <div
                    className="chat-message assistant typing-indicator"
                    aria-label="Buscando conteúdo aprovado"
                  >
                    <Bot aria-hidden="true" />
                    <p>
                      <span />
                      <span />
                      <span />
                    </p>
                  </div>
                )}
              </div>
              <div className="help-chat-quick-actions" aria-label="Ações rápidas">
                {quickActions.map((action) => (
                  <button
                    type="button"
                    key={action}
                    onClick={() => void ask(action)}
                    disabled={typing}
                  >
                    {action}
                  </button>
                ))}
                <Link href="/minha-conta/atendimento?new=1" onClick={close}>
                  Falar com atendimento
                </Link>
              </div>
              <Link className="help-human-link" href="/ajuda" onClick={close}>
                Abrir Central de Ajuda completa
              </Link>
              <form className="help-chat-form" onSubmit={submit}>
                <label className="sr-only" htmlFor="help-chat-message">
                  Digite sua mensagem
                </label>
                <input
                  id="help-chat-message"
                  name="message"
                  ref={inputRef}
                  placeholder="Digite sua dúvida…"
                  autoComplete="off"
                  maxLength={160}
                  disabled={typing}
                />
                <button type="submit" disabled={typing} aria-label="Enviar mensagem">
                  {typing ? <LoaderCircle className="spin" /> : <Send />}
                </button>
              </form>
            </>
          )}
        </section>
      )}

      <button
        className={open ? "help-launcher is-open" : "help-launcher"}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label={open ? "Fechar ajuda" : "Abrir ajuda"}
        aria-expanded={open}
      >
        <MessageCircle />
        <span>Posso ajudar?</span>
      </button>
    </div>
  );
}
