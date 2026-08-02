import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { PasswordRecoveryForm } from "@/components/password-recovery-form";

export const metadata = { title: "Definir nova senha", robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return (
    <main className="auth-page">
      <section className="auth-card auth-signup-card">
        <Link className="auth-back-link" href="/login">
          <ArrowLeft aria-hidden="true" /> Voltar para o login
        </Link>
        <header className="auth-card-header">
          <span className="auth-kicker">Link confirmado</span>
          <h1>Crie uma nova senha</h1>
          <p>Escolha uma senha exclusiva para proteger sua conta Curtiz.</p>
        </header>
        <PasswordRecoveryForm mode="update" />
        <p className="auth-security-note">
          <ShieldCheck aria-hidden="true" /> Esta alteração exige uma sessão temporária criada pelo link recebido.
        </p>
      </section>
    </main>
  );
}
