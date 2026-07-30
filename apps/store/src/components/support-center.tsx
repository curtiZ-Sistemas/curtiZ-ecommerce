"use client";

import { CircleCheck, Headphones, LoaderCircle, Send, X } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";

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
  },
  {
    question: "Não consigo entrar na conta",
    answer:
      "Use a recuperação de senha. Por segurança, a resposta será sempre genérica e não confirmará se um e-mail existe.",
    action: "Recuperar acesso",
    href: "/esqueci-senha"
  },
  {
    question: "Meu pedido está atrasado",
    answer:
      "Selecione o pedido para consultar o último evento e a previsão. Se o prazo venceu, abra um atendimento vinculado à compra.",
    action: "Consultar entrega",
    href: "/minha-conta/pedidos"
  }
] as const;

export function SupportCenter() {
  const [selected, setSelected] = useState<(typeof quickAnswers)[number] | null>(null);
  const [human, setHuman] = useState(false);
  const [ticket, setTicket] = useState("");
  const [message, setMessage] = useState("");
  const [resolved, setResolved] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: form.get("subject"),
          message: form.get("message"),
          category: form.get("category")
        })
      });
      const result = (await response.json()) as { ok: boolean; publicCode?: string; message?: string };
      if (result.ok && result.publicCode) {
        setTicket(result.publicCode);
        event.currentTarget.reset();
      } else {
        setMessage(result.message ?? "Não foi possível criar o atendimento.");
      }
    } catch {
      setMessage("Não foi possível conectar ao atendimento. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="help-grid">
        {quickAnswers.map((item) => (
          <button
            className="help-card"
            type="button"
            key={item.question}
            onClick={() => {
              setSelected(item);
              setResolved(false);
            }}
          >
            <strong>{item.question}</strong>
            <p>Ver resposta e ações relacionadas →</p>
          </button>
        ))}
      </div>
      {selected && (
        <section className="help-answer" aria-live="polite">
          <button className="help-answer-close" type="button" onClick={() => setSelected(null)} aria-label="Fechar resposta">
            <X />
          </button>
          <p className="eyebrow">{resolved ? "Obrigado pelo retorno" : "Resposta rápida"}</p>
          <h2>{selected.question}</h2>
          <p>{resolved ? "Que bom que conseguimos ajudar. Se precisar, o atendimento continua disponível." : selected.answer}</p>
          <div className="option-row">
            <button className="secondary-button" type="button" onClick={() => setResolved(true)} disabled={resolved}>
              <CircleCheck size={18} /> Sim, resolveu
            </button>
            <Link className="secondary-button" href={selected.href}>
              {selected.action}
            </Link>
            <button className="primary-button" type="button" onClick={() => setHuman(true)}>
              <Headphones size={18} /> Falar com um humano
            </button>
          </div>
        </section>
      )}
      {human && (
        <section className="chat-box" aria-labelledby="human-title">
          <p className="eyebrow">Atendimento humano</p>
          <h2 id="human-title">Abrir novo atendimento</h2>
          <p>
            Seu chamado entrará na fila do Administrador. O Operacional só terá acesso se houver
            transferência explícita.
          </p>
          <p className="chat-warning">
            Nunca envie senhas, códigos de segurança, número completo de cartão ou CVV pelo
            atendimento.
          </p>
          {ticket ? (
            <div className="form-message" role="status">
              Atendimento <strong>{ticket}</strong> criado e enviado à fila administrativa.
            </div>
          ) : (
            <form
              className="form-stack"
              onSubmit={(event) => {
                void submit(event);
              }}
            >
              <div className="field">
                <label htmlFor="support-category">Assunto</label>
                <select id="support-category" name="category" required>
                  <option value="order">Pedido</option>
                  <option value="payment">Pagamento</option>
                  <option value="delivery">Entrega</option>
                  <option value="return">Troca ou devolução</option>
                  <option value="technical">Problema técnico</option>
                  <option value="other">Outro</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="support-subject">Título</label>
                <input id="support-subject" name="subject" required minLength={5} maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor="support-message">Mensagem</label>
                <textarea id="support-message" name="message" required minLength={10} maxLength={4000} />
              </div>
              {message && <p className="form-message">{message}</p>}
              <button className="primary-button full-button" disabled={loading}>
                {loading ? <LoaderCircle className="spin" /> : <Send size={18} />}
                {loading ? "Enviando atendimento…" : "Enviar para a equipe"}
              </button>
            </form>
          )}
        </section>
      )}
    </>
  );
}
