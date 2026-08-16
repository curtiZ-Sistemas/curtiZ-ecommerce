"use client";

import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useState } from "react";
import { CUSTOMER_EMAIL_MAX_LENGTH } from "@/lib/personal-data";
import { TurnstileField } from "./turnstile-field";

type PasswordResult = { message?: string; redirectTo?: string };

export function PasswordRecoveryForm({
  mode,
  turnstileEnabled = false
}: {
  mode: "request" | "update";
  turnstileEnabled?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const handleTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setMessage("");
    setError(false);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form);
    if (turnstileEnabled && mode === "request") payload.turnstileToken = turnstileToken;
    payload.action = mode;
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = (await response.json()) as PasswordResult;
      setMessage(result.message ?? "Não foi possível concluir esta etapa.");
      setError(!response.ok);
      if (response.ok && result.redirectTo) {
        window.setTimeout(() => router.replace(result.redirectTo ?? "/minha-conta"), 700);
      }
    } catch {
      setError(true);
      setMessage("Não foi possível conectar ao serviço. Tente novamente em instantes.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="form-stack auth-form" onSubmit={(event) => void submit(event)}>
      {mode === "request" ? (
        <div className="field">
          <label htmlFor="recovery-email">E-mail da conta</label>
          <div className="input-shell">
            <Mail aria-hidden="true" />
            <input
              id="recovery-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={CUSTOMER_EMAIL_MAX_LENGTH}
              placeholder="voce@exemplo.com.br"
              required
            />
          </div>
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="new-password">Nova senha</label>
            <div className="input-shell">
              <LockKeyhole aria-hidden="true" />
              <input
                id="new-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={10}
                placeholder="Crie uma senha com pelo menos 10 caracteres"
                required
              />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirmar nova senha</label>
            <div className="input-shell">
              <LockKeyhole aria-hidden="true" />
              <input
                id="confirm-password"
                name="confirmPassword"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={10}
                required
              />
            </div>
          </div>
        </>
      )}

      {mode === "request" && (
        <TurnstileField enabled={turnstileEnabled} onToken={handleTurnstileToken} />
      )}

      {message && (
        <p className={`form-message ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>
          {message}
        </p>
      )}

      <button
        className="primary-button full-button auth-submit"
        disabled={loading || (mode === "request" && turnstileEnabled && !turnstileToken)}
      >
        {loading ? <LoaderCircle className="spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
        {loading
          ? "Processando…"
          : mode === "request"
            ? "Enviar link de recuperação"
            : "Atualizar minha senha"}
      </button>
    </form>
  );
}
