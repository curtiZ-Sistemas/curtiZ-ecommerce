"use client";

import Image from "next/image";
import { type FormEvent, useEffect, useRef, useState } from "react";

type Enrollment = { qrCode: string; secret: string };
type MfaResponse = { ok: boolean; factorId?: string | null; enrollment?: Enrollment };

export function MfaForm({ destination }: { destination: string }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [factorId, setFactorId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const preparing = useRef<Promise<MfaResponse> | null>(null);

  useEffect(() => {
    let active = true;
    // Share preparation across Strict Mode effect replay; enrollment is a mutation.
    preparing.current ??= (async () => {
      const response = await fetch("/api/auth/mfa", { credentials: "same-origin", cache: "no-store" });
      const state = await response.json() as MfaResponse;
      if (!response.ok || !state.ok) throw new Error("mfa_unavailable");
      if (state.factorId) return state;
      const enrolled = await fetch("/api/auth/mfa", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "enroll" })
      });
      const result = await enrolled.json() as MfaResponse;
      if (!enrolled.ok || !result.ok) throw new Error("mfa_unavailable");
      return result;
    })();
    void preparing.current.then((result) => {
      if (!active) return;
      setFactorId(result.factorId ?? "");
      setEnrollment(result.enrollment ?? null);
      preparing.current = null;
    }).catch(() => {
      if (active) setMessage("Não foi possível preparar o autenticador. Recarregue a página para tentar novamente.");
      preparing.current = null;
    }).finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!factorId || submitting) return;
    const form = new FormData(event.currentTarget);
    const rawCode = form.get("code");
    const code = (typeof rawCode === "string" ? rawCode : "").replace(/\D/gu, "");
    if (code.length !== 6) {
      setMessage("Digite o código de seis números do autenticador.");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/mfa", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify", factorId, code })
      });
      if (!response.ok) {
        setMessage("Código inválido ou expirado, ou limite de tentativas atingido. Aguarde e tente novamente.");
        return;
      }
      setEnrollment(null);
      setFactorId("");
      preparing.current = null;
      window.location.assign(destination);
    } catch {
      setMessage("Não foi possível conectar. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="form-card mfa-card" aria-busy={loading || submitting}>
      {enrollment && (
        <div className="mfa-enrollment">
          <h2>Configure seu autenticador</h2>
          <p>Leia o QR code em um aplicativo TOTP. Esta etapa é exigida para acessos internos.</p>
          <Image
            src={enrollment.qrCode}
            alt="QR code para configurar o autenticador"
            width={192}
            height={192}
            unoptimized
          />
          <details>
            <summary>Configurar manualmente</summary>
            <code>{enrollment.secret}</code>
          </details>
        </div>
      )}
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="mfa-code">Código de verificação</label>
        <input
          id="mfa-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          disabled={loading || submitting || !factorId}
          required
        />
        {message && <p className="form-error" role="alert">{message}</p>}
        <button className="primary-button" disabled={loading || submitting || !factorId}>
          {loading ? "Preparando…" : submitting ? "Verificando…" : "Confirmar acesso"}
        </button>
      </form>
    </section>
  );
}
