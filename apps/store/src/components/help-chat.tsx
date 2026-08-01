"use client";

import { Bot, ChevronDown, Headphones, LoaderCircle, MessageCircle, Send, X } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";

type ChatMessage = {
  id: number;
  author: "assistant" | "customer";
  text: string;
};

const initialMessage: ChatMessage = {
  id: 1,
  author: "assistant",
  text: "Olá! Sou o assistente virtual de demonstração da Curtiz. Posso ajudar com pedidos, entregas, trocas e formas de pagamento."
};

function simulatedReply(message: string) {
  const normalized = message.toLocaleLowerCase("pt-BR");
  if (normalized.includes("pedido") || normalized.includes("rastre")) {
    return "Para acompanhar um pedido, acesse Minha conta › Pedidos. Os eventos exibidos são os confirmados pelo servidor.";
  }
  if (normalized.includes("troca") || normalized.includes("devol")) {
    return "Você pode iniciar uma troca pela área do pedido. Prazo e elegibilidade são conferidos antes da solicitação.";
  }
  if (normalized.includes("frete") || normalized.includes("entrega")) {
    return "O prazo e o valor do frete são calculados pelo CEP. Em desenvolvimento, o provedor de frete está identificado como mock.";
  }
  if (normalized.includes("pagamento") || normalized.includes("pix")) {
    return "O pagamento só é confirmado após validação do servidor. A página de retorno nunca aprova um pedido sozinha.";
  }
  return "Entendi. Posso orientar sobre pedido, entrega, troca ou pagamento. Para um caso específico, abra um atendimento humano na Central de ajuda.";
}

export function HelpChat() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [typing, setTyping] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !minimized) inputRef.current?.focus();
  }, [minimized, open]);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  const close = () => {
    setOpen(false);
    setMinimized(false);
    setTyping(false);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (typing) return;
    const form = new FormData(event.currentTarget);
    const rawMessage = form.get("message");
    const text = typeof rawMessage === "string" ? rawMessage.trim() : "";
    if (!text) return;

    const nextId = Date.now();
    setMessages((current) => [...current, { id: nextId, author: "customer", text }]);
    event.currentTarget.reset();
    setTyping(true);

    window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        { id: nextId + 1, author: "assistant", text: simulatedReply(text) }
      ]);
      setTyping(false);
    }, 650);
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
              <span><i /> Assistente de demonstração</span>
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
                <p className="help-chat-disclaimer">
                  Respostas simuladas enquanto o provedor de chatbot estiver em modo mock.
                </p>
                {messages.map((message) => (
                  <div className={`chat-message ${message.author}`} key={message.id}>
                    {message.author === "assistant" && <Bot aria-hidden="true" />}
                    <p>{message.text}</p>
                  </div>
                ))}
                {typing && (
                  <div className="chat-message assistant typing-indicator" aria-label="Digitando">
                    <Bot aria-hidden="true" />
                    <p><span /><span /><span /></p>
                  </div>
                )}
              </div>
              <Link
                className="help-human-link"
                href="/minha-conta/atendimento?new=1"
                onClick={close}
              >
                Precisa de uma pessoa? Abrir atendimento humano
              </Link>
              <form className="help-chat-form" onSubmit={submit}>
                <label className="sr-only" htmlFor="help-chat-message">
                  Digite sua mensagem
                </label>
                <input
                  id="help-chat-message"
                  name="message"
                  ref={inputRef}
                  placeholder="Digite sua mensagem..."
                  autoComplete="off"
                  maxLength={500}
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
        onClick={() => {
          if (open) {
            setMinimized(false);
          } else {
            setOpen(true);
          }
        }}
        aria-label={open ? "Retomar conversa de ajuda" : "Abrir ajuda"}
        aria-expanded={open}
      >
        <MessageCircle />
        <span>Precisa de ajuda?</span>
      </button>
    </div>
  );
}
