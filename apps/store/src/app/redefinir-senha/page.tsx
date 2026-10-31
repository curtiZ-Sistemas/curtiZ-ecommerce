import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PasswordRecoveryForm } from "@/components/password-recovery-form";
import { verifyRecoverySession } from "@/lib/password-recovery";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { RECOVERY_PROOF_COOKIE } from "@/lib/recovery-proof";

export const metadata = { title: "Definir nova senha", robots: { index: false, follow: false } };

export default async function ResetPasswordPage() {
  const supabase = await createServerSupabaseClient();
  const cookieStore = await cookies();
  const recovery = supabase ? await verifyRecoverySession(supabase, {
    value: cookieStore.get(RECOVERY_PROOF_COOKIE)?.value, key: process.env.RATE_LIMIT_HMAC_KEY ?? ""
  }) : null;
  const ready = recovery?.status === "ok";
  return (
    <main className="auth-page">
      <section className="auth-card auth-signup-card">
        <Link className="auth-back-link" href="/login">
          <ArrowLeft aria-hidden="true" /> Voltar para o login
        </Link>
        {ready ? (
          <>
            <header className="auth-card-header">
              <span className="auth-kicker">Link confirmado</span>
              <h1>Crie uma nova senha</h1>
              <p>Escolha a nova senha da sua conta curti Z.</p>
            </header>
            <PasswordRecoveryForm mode="update" />
          </>
        ) : (
          <>
            <header className="auth-card-header">
              <span className="auth-kicker">Recuperação de acesso</span>
              <h1>Link indisponível</h1>
              <p>Não foi possível validar este link. Ele pode ter sido usado ou expirado. Solicite um novo para continuar.</p>
            </header>
            <Link className="primary-button full-button auth-submit" href="/esqueci-senha">
              Solicitar novo link
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
