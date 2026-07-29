"use client";

import { type FormEvent, useState } from "react";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form))
    });
    const result = (await response.json()) as { message: string };
    setMessage(result.message);
    setLoading(false);
  };

  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      {mode === "signup" && (
        <div className="field">
          <label htmlFor="signup-name">Nome completo</label>
          <input id="signup-name" name="name" autoComplete="name" required minLength={3} />
        </div>
      )}
      <div className="field">
        <label htmlFor={`${mode}-email`}>E-mail</label>
        <input id={`${mode}-email`} name="email" type="email" autoComplete="email" required />
      </div>
      {mode === "signup" && (
        <div className="field">
          <label htmlFor="signup-phone">WhatsApp (opcional)</label>
          <input id="signup-phone" name="phone" autoComplete="tel" />
        </div>
      )}
      <div className="field">
        <label htmlFor={`${mode}-password`}>Senha</label>
        <input
          id={`${mode}-password`}
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={10}
          required
        />
      </div>
      {mode === "signup" && (
        <>
          <div className="field">
            <label htmlFor="signup-confirm">Confirmar senha</label>
            <input
              id="signup-confirm"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
            />
          </div>
          <label>
            <input name="terms" type="checkbox" required /> Li e aceito os Termos de Uso e a
            Política de Privacidade.
          </label>
          <label>
            <input name="marketing" type="checkbox" /> Quero receber novidades da Curtiz.
          </label>
        </>
      )}
      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
      <button className="primary-button full-button" disabled={loading}>
        {loading ? "Processando..." : mode === "login" ? "Entrar" : "Criar conta"}
      </button>
    </form>
  );
}
