import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PasswordRecoveryForm } from "@/components/password-recovery-form";

export const metadata = { title: "Recuperar senha", robots: { index: false, follow: false } };

export default function PasswordRecoveryPage() {
  return (
    <main className="auth-page">
      <section className="auth-card auth-signup-card">
        <Link className="auth-back-link" href="/login">
          <ArrowLeft aria-hidden="true" /> Voltar para o login
        </Link>
        <header className="auth-card-header">
          <span className="auth-kicker">Recuperação de acesso</span>
          <h1>Redefina sua senha</h1>
          <p>Enviaremos as instruções para o e-mail informado.</p>
        </header>
        <PasswordRecoveryForm turnstileEnabled={process.env.TURNSTILE_ENABLED === "true"} mode="request" />
      </section>
    </main>
  );
}
