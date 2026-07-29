"use client";

import { ArrowUpRight, Send, UserRoundCheck } from "lucide-react";
import { useState } from "react";

const conversations = [
  { code: "ATD-7F9C2A10", subject: "Pedido atrasado", customer: "Cliente D.", priority: "Alta" },
  { code: "ATD-92F1B880", subject: "Dúvida sobre troca", customer: "Cliente B.", priority: "Normal" },
  { code: "ATD-11A7C029", subject: "Pagamento pendente", customer: "Cliente R.", priority: "Urgente" }
];

export function SupportConsole({ role }: { role: string }) {
  const [selected, setSelected] = useState(conversations[0]);
  const [messages, setMessages] = useState([
    { agent: false, text: "Olá! Meu pedido passou da previsão e não atualizou." }
  ]);
  const [reply, setReply] = useState("");
  const [notice, setNotice] = useState("");

  if (!selected) return null;
  const canRoute = role === "administracao";

  const send = () => {
    if (!reply.trim()) return;
    setMessages((current) => [...current, { agent: true, text: reply.trim() }]);
    setReply("");
    setNotice("Resposta adicionada à demonstração. A persistência exige Supabase local.");
  };

  return (
    <div className="support-layout">
      <section className="panel-card conversation-list">
        <h2>Fila de atendimentos</h2>
        {role === "operacional" && (
          <p className="demo-status">Somente chamados transferidos ao Operacional</p>
        )}
        {conversations.map((conversation) => (
          <button key={conversation.code} onClick={() => setSelected(conversation)}>
            <strong>{conversation.subject}</strong>
            <small>
              {conversation.code} • {conversation.customer} • {conversation.priority}
            </small>
          </button>
        ))}
      </section>
      <section className="panel-card">
        <div className="page-heading">
          <div>
            <h2>{selected.subject}</h2>
            <p>{selected.code} • Fila do Administrador</p>
          </div>
          <span className="status orange">Em atendimento</span>
        </div>
        <div className="message-thread" aria-live="polite">
          {messages.map((message, index) => (
            <div className={message.agent ? "message agent" : "message"} key={`${message.text}-${index}`}>
              {message.text}
            </div>
          ))}
          <div className="internal-note">
            Nota interna: visível somente aos colaboradores autorizados, nunca ao cliente.
          </div>
        </div>
        {notice && <p className="demo-status">{notice}</p>}
        <div className="reply-box">
          <label className="sr-only" htmlFor="support-reply">
            Resposta
          </label>
          <input
            id="support-reply"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            placeholder="Digite uma resposta segura..."
            onKeyDown={(event) => {
              if (event.key === "Enter") send();
            }}
          />
          <button className="primary-button" onClick={send}>
            <Send size={17} /> Enviar
          </button>
        </div>
        {canRoute && (
          <div className="toolbar" style={{ marginTop: 14, flexWrap: "wrap" }}>
            <button className="secondary-button" onClick={() => setNotice("Atendimento assumido pelo Administrador.")}>
              <UserRoundCheck size={17} /> Assumir
            </button>
            <button className="secondary-button" onClick={() => setNotice("Transferência requer motivo e será auditada.")}>
              <ArrowUpRight size={17} /> Transferir
            </button>
            <button className="secondary-button" onClick={() => setNotice("Escalonamento exige categoria, contexto e justificativa.")}>
              Escalar
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
