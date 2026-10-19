"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { setClientAuthPersistence } from "../lib/session-persistence-client";

export const GOOGLE_TERMS_REQUIRED_MESSAGE =
  "Aceite os Termos de Uso e a Política de Privacidade para continuar com Google.";
const GOOGLE_FAILURE_MESSAGE = "Não foi possível entrar com Google. Tente novamente.";

export type GoogleStartResult =
  | { ok: true; redirectTo: string; alreadyAuthenticated: boolean }
  | { ok: false; message: string };

/** Starts the server-validated Google flow. Only consent, persistence and the return path are sent. */
export async function startGoogleSignIn(input: {
  terms: boolean;
  marketing?: boolean;
  remember: boolean;
  returnTo?: string;
}): Promise<GoogleStartResult> {
  if (!input.terms) return { ok: false, message: GOOGLE_TERMS_REQUIRED_MESSAGE };
  try {
    const response = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        terms: true,
        marketing: input.marketing === true,
        remember: input.remember,
        ...(input.returnTo ? { next: input.returnTo } : {})
      })
    });
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Invalid reply");
    const data = result as Record<string, unknown>;
    if (!response.ok || typeof data.redirectTo !== "string") {
      return {
        ok: false,
        message: typeof data.message === "string" ? data.message : GOOGLE_FAILURE_MESSAGE
      };
    }
    return { ok: true, redirectTo: data.redirectTo, alreadyAuthenticated: data.alreadyAuthenticated === true };
  } catch {
    return { ok: false, message: GOOGLE_FAILURE_MESSAGE };
  }
}

export function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19Z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
      />
    </svg>
  );
}

export function GoogleSignIn({
  available,
  returnTo,
  signup = false
}: {
  available: boolean;
  returnTo?: string;
  signup?: boolean;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !available) return;
    const form = new FormData(event.currentTarget);
    const remember = form.get("remember") === "on";
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await startGoogleSignIn({
        terms: form.get("terms") === "on",
        marketing: form.get("marketing") === "on",
        remember,
        returnTo
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      if (!result.alreadyAuthenticated) setClientAuthPersistence(remember);
      window.location.assign(result.redirectTo);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="google-sign-in" aria-label="Acesso com Google">
      <form
        method="post"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        {available ? (
          <>
            <label className="check-row">
              <input name="terms" type="checkbox" required disabled={!hydrated || busy} />
              <span>
                Li e aceito os <Link href="/termos-de-uso">Termos de Uso</Link> e a{" "}
                <Link href="/politica-de-privacidade">Política de Privacidade</Link> para continuar
                com Google.
              </span>
            </label>
            {signup ? (
              <label className="check-row">
                <input name="marketing" type="checkbox" disabled={!hydrated || busy} />
                <span>
                  Quero receber novidades e ofertas da curti Z.{" "}
                  <span className="optional-label">Opcional</span>
                </span>
              </label>
            ) : null}
            <label className="check-row">
              <input name="remember" type="checkbox" disabled={!hydrated || busy} />
              <span>Lembrar meu acesso neste dispositivo</span>
            </label>
          </>
        ) : null}
        <button
          className="google-sign-in-button"
          type="submit"
          disabled={!available || !hydrated || busy}
          aria-describedby={!available ? "google-sign-in-unavailable" : undefined}
        >
          <GoogleMark />
          <span>{busy ? "Conectando…" : "Continuar com Google"}</span>
        </button>
      </form>
      {!available ? (
        <p id="google-sign-in-unavailable" className="form-message">
          Login com Google indisponível no momento. Use e-mail e senha.
        </p>
      ) : null}
      {message ? (
        <p className="form-message" role="alert">
          {message}
        </p>
      ) : null}
      <div className="auth-divider">
        <span>ou use seu e-mail</span>
      </div>
    </section>
  );
}
