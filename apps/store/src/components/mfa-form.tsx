"use client";

import Image from "next/image";
import { type FormEvent, useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type Enrollment = { factorId: string; qrCode: string; secret: string };

export function MfaForm({ destination }: { destination: string }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [factorId, setFactorId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const prepare = async () => {
      const supabase = createBrowserSupabaseClient();
      if (!supabase) {
        if (active) setMessage("A autenticação multifator não está configurada.");
        return;
      }
      const listed = await supabase.auth.mfa.listFactors();
      if (listed.error) {
        if (active) setMessage("Não foi possível carregar os fatores de segurança.");
        return;
      }
      const verified = listed.data.totp.find((factor) => factor.status === "verified");
      if (verified) {
        if (active) setFactorId(verified.id);
        return;
      }
      for (const factor of listed.data.totp.filter((item) => item.status !== "verified")) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
      const enrolled = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Acesso interno Curtiz"
      });
      if (enrolled.error) {
        if (active) setMessage("Não foi possível preparar o autenticador.");
        return;
      }
      if (active) {
        setFactorId(enrolled.data.id);
        setEnrollment({
          factorId: enrolled.data.id,
          qrCode: enrolled.data.totp.qr_code,
          secret: enrolled.data.totp.secret
        });
      }
    };
    void prepare().finally(() => active && setLoading(false));
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
    const supabase = createBrowserSupabaseClient();
    const result = supabase
      ? await supabase.auth.mfa.challengeAndVerify({ factorId, code })
      : { error: new Error("Supabase indisponível") };
    if (result.error) {
      setMessage("Código inválido ou expirado. Confira o autenticador e tente novamente.");
      setSubmitting(false);
      return;
    }
    window.location.assign(destination);
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
