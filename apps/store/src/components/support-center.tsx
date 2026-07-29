"use client";

import { CircleCheck, Headphones, Send } from "lucide-react";
import { type FormEvent, useState } from "react";

const quickAnswers = [
  {
    question: "Como funciona o frete?",
    answer:
      "O valor e o prazo são calculados pelo CEP na página do produto, no carrinho ou no checkout. O prazo começa após a confirmação do pagamento.",
    action: "Calcular frete"
  },
  {
    question: "Como rastrear meu pedido?",
    answer:
      "Acesse Minha conta › Pedidos e selecione a compra. Quando houver rastreio, os eventos e a previsão atualizada aparecerão na linha do tempo.",
    action: "Consultar pedido"
  },
  {
    question: "Meu pagamento foi aprovado?",
    answer:
      "O status exibido na sua conta vem da confirmação do servidor. A página de retorno do pagamento, sozinha, nunca altera o pedido para pago.",
    action: "Ver meus pedidos"
  },
  {
    question: "Como solicitar uma troca?",
    answer:
      "Na página do pedido, escolha o item e toque em Solicitar troca. O sistema verificará prazo, quantidade e necessidade de fotos.",
    action: "Ver política de trocas"
  },
  {
    question: "Não consigo entrar na conta",
    answer:
      "Use a recuperação de senha. Por segurança, a resposta será sempre genérica e não confirmará se um e-mail existe.",
    action: "Recuperar acesso"
  },
  {
    question: "Meu pedido está atrasado",
    answer:
      "Selecione o pedido para consultar o último evento e a previsão. Se o prazo venceu, abra um atendimento vinculado à compra.",
    action: "Consultar entrega"
  }
] as const;

export function SupportCenter() {
  const [selected, setSelected] = useState<(typeof quickAnswers)[number] | null>(null);
  const [human, setHuman] = useState(false);
  const [ticket, setTicket] = useState("");
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
      setMessage("");
      event.currentTarget.reset();
    } else {
      setMessage(result.message ?? "Não foi possível criar o atendimento.");
    }
  };

  return (
    <>
      <div className="help-grid">
        {quickAnswers.map((item) => (
          <button className="help-card" key={item.question} onClick={() => setSelected(item)}>
            <strong>{item.question}</strong>
            <p>Ver resposta e ações relacionadas →</p>
          </button>
        ))}
      </div>
      {selected && (
        <section className="help-answer" aria-live="polite">
          <p className="eyebrow">Resposta rápida</p>
          <h2>{selected.question}</h2>
          <p>{selected.answer}</p>
          <div className="option-row">
            <button className="secondary-button">
              <CircleCheck size={18} /> Sim, resolveu
            </button>
            <button className="secondary-button" onClick={() => setHuman(true)}>
              Ainda preciso de ajuda
            </button>
            <button className="primary-button" onClick={() => setHuman(true)}>
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
              <button className="primary-button full-button">
                <Send size={18} /> Enviar para a equipe
              </button>
            </form>
          )}
        </section>
      )}
    </>
  );
}
