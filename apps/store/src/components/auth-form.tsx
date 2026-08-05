"use client";

import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  UserRound
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useRef, useState } from "react";
import { TurnstileField } from "./turnstile-field";

type AuthResult = {
  code?: string;
  message: string;
  redirectTo?: string;
};

export function AuthForm({
  mode,
  returnTo,
  turnstileEnabled = false
}: {
  mode: "login" | "signup";
  returnTo?: string;
  turnstileEnabled?: boolean;
}) {
  const [message, setMessage] = useState("");
  const [messageCode, setMessageCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const isSubmittingRef = useRef(false);
  const handleTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;

    isSubmittingRef.current = true;
    setLoading(true);
    setMessage("");
    setMessageCode("");

    try {
      const form = new FormData(event.currentTarget);
      const payload = Object.fromEntries(form);
      if (typeof payload.email === "string") {
        payload.email = payload.email.trim().toLocaleLowerCase("pt-BR");
      }
      if (turnstileEnabled) payload.turnstileToken = turnstileToken;
      if (mode === "login" && returnTo) payload.next = returnTo;
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = (await response.json()) as AuthResult;
      setMessage(result.message);
      setMessageCode(result.code ?? "");
      if (response.ok && result.redirectTo) window.location.assign(result.redirectTo);
    } catch {
      setMessage("Não foi possível acessar o serviço agora. Tente novamente em alguns instantes.");
      setMessageCode("");
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <form
      className="form-stack auth-form"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      {mode === "signup" && (
        <div className="field">
          <label htmlFor="signup-name">Nome completo</label>
          <div className="input-shell">
            <UserRound aria-hidden="true" />
            <input
              id="signup-name"
              name="name"
              autoComplete="name"
              placeholder="Como você gostaria de ser chamado?"
              required
              minLength={3}
            />
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor={`${mode}-email`}>{mode === "login" ? "E-mail de acesso" : "E-mail"}</label>
        <div className="input-shell">
          <Mail aria-hidden="true" />
          <input
            id={`${mode}-email`}
            name="email"
            type="email"
            autoComplete="email"
            placeholder={mode === "login" ? "voce@exemplo.com.br" : "seu melhor e-mail"}
            required
          />
        </div>
      </div>

      {mode === "signup" && (
        <div className="field">
          <label htmlFor="signup-phone">
            WhatsApp <span className="optional-label">opcional</span>
          </label>
          <input
            id="signup-phone"
            name="phone"
            autoComplete="tel"
            inputMode="tel"
            placeholder="(11) 99999-9999"
          />
        </div>
      )}

      <div className="field">
        <div className="field-heading">
          <label htmlFor={`${mode}-password`}>Senha</label>
          {mode === "login" && (
            <Link className="text-link subtle-link" href="/esqueci-senha">
              Esqueci minha senha
            </Link>
          )}
        </div>
        <div className="input-shell">
          <LockKeyhole aria-hidden="true" />
          <input
            id={`${mode}-password`}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="Digite sua senha"
            minLength={6}
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

      {mode === "login" && (
        <label className="check-row">
          <input name="remember" type="checkbox" />
          <span>Lembrar meu acesso neste dispositivo</span>
        </label>
      )}

      {mode === "signup" && (
        <>
          <div className="field">
            <label htmlFor="signup-confirm">Confirmar senha</label>
            <div className="input-shell">
              <Check aria-hidden="true" />
              <input
                id="signup-confirm"
                name="confirmPassword"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Repita a senha"
                minLength={6}
                required
              />
            </div>
          </div>
          <label className="check-row">
            <input name="terms" type="checkbox" required />
            <span>
              Li e aceito os <Link href="/termos-de-uso">Termos de Uso</Link> e a{" "}
              <Link href="/politica-de-privacidade">Política de Privacidade</Link>.
            </span>
          </label>
          <label className="check-row">
            <input name="marketing" type="checkbox" />
            <span>Quero receber novidades e ofertas da curti Z.</span>
          </label>
        </>
      )}

      {message && (
        <p className="form-message auth-form-message" role="status" aria-live="polite">
          {messageCode === "user_not_found" ? "Esse usuário não existe." : message}
          {mode === "login" && messageCode === "user_not_found" && (
            <>
              {" "}
              <Link href="/cadastro">Cadastre-se</Link>
            </>
          )}
        </p>
      )}

      <TurnstileField enabled={turnstileEnabled} onToken={handleTurnstileToken} />

      <button
        className="primary-button full-button auth-submit"
        type="submit"
        disabled={loading || (turnstileEnabled && !turnstileToken)}
        aria-busy={loading}
      >
        {loading ? (
          <>
            <LoaderCircle className="spin" aria-hidden="true" /> Processando
          </>
        ) : (
          <>
            {mode === "login" ? "Entrar na minha conta" : "Criar minha conta"}
            <ArrowRight aria-hidden="true" />
          </>
        )}
      </button>
    </form>
  );
}
