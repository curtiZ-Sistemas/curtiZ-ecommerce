"use client";

import { type FormEvent, useState } from "react";
import { CheckCircle2, LoaderCircle, Send } from "lucide-react";

export function PrivacyRequestForm() {
  const [pending, setPending] = useState(false);
  const [protocol, setProtocol] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/privacy/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestType: form.get("requestType"),
          name: form.get("name"),
          email: form.get("email"),
          details: form.get("details")
        })
      });
      const payload: unknown = await response.json();
      const result =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {};
      if (!response.ok || typeof result.protocol !== "string")
        throw new Error(
          typeof result.message === "string"
            ? result.message
            : "Não foi possível registrar a solicitação."
        );
      setProtocol(result.protocol);
      event.currentTarget.reset();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Não foi possível registrar a solicitação."
      );
    } finally {
      setPending(false);
    }
  };
  if (protocol)
    return (
      <section className="privacy-request-success" role="status">
        <CheckCircle2 />
        <h2>Solicitação registrada</h2>
        <p>
          Protocolo: <strong>{protocol}</strong>
        </p>
        <p>
          A identidade ainda precisará ser verificada. O registro não provoca exclusão automática de
          dados sujeitos a retenção ou defesa de direitos.
        </p>
        <button className="secondary-button" onClick={() => setProtocol("")}>
          Nova solicitação
        </button>
      </section>
    );
  return (
    <form className="privacy-request-form" onSubmit={(event) => void submit(event)}>
      <label>
        Tipo de solicitação
        <select name="requestType" required>
          <option value="confirmation">Confirmação de tratamento</option>
          <option value="access">Acesso aos dados</option>
          <option value="correction">Correção</option>
          <option value="sharing">Informações de compartilhamento</option>
          <option value="withdraw_consent">Revogação de consentimento</option>
          <option value="opposition">Oposição</option>
          <option value="deletion">Eliminação quando aplicável</option>
          <option value="portability">Portabilidade quando aplicável</option>
          <option value="automated_review">Revisão de decisão automatizada</option>
          <option value="other">Outra solicitação</option>
        </select>
      </label>
      <label>
        Nome completo
        <input name="name" minLength={3} maxLength={120} autoComplete="name" required />
      </label>
      <label>
        E-mail para verificação
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label className="wide">
        Detalhes
        <textarea
          name="details"
          minLength={10}
          maxLength={2000}
          required
          placeholder="Descreva objetivamente sua solicitação. Não envie senhas, cartões ou documentos nesta etapa."
        />
      </label>
      {error && (
        <p className="form-message error wide" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button wide" disabled={pending}>
        {pending ? <LoaderCircle className="spin" /> : <Send />} Enviar solicitação
      </button>
    </form>
  );
}
