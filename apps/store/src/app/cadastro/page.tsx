import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Criar conta", robots: { index: false, follow: false } };

export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ indicacao?: string }>;
}) {
  const referralStatus = (await searchParams).indicacao;
  return (
    <div className="auth-page">
      <section className="auth-card auth-signup-card">
        <Link className="auth-back-link" href="/login">
          <ArrowLeft aria-hidden="true" /> Voltar para o login
        </Link>
        <header className="auth-card-header">
          <span className="auth-kicker">Conta Curtiz</span>
          <h1>Crie sua conta</h1>
          <p>Leva poucos minutos. Endereço e CPF serão solicitados somente quando necessários.</p>
        </header>
        {referralStatus === "confirmada" && (
          <p className="form-message success" role="status">
            Indicação confirmada. O vínculo será validado com segurança depois que você entrar.
          </p>
        )}
        {referralStatus === "invalida" && (
          <p className="form-message error" role="alert">
            Este link de indicação não é válido ou não está mais ativo.
          </p>
        )}
        {referralStatus === "indisponivel" && (
          <p className="form-message error" role="alert">
            Não foi possível registrar a indicação agora. Solicite um novo link ao representante.
          </p>
        )}
        <AuthForm mode="signup" turnstileEnabled={process.env.TURNSTILE_ENABLED === "true"} />
        <p className="auth-security-note">
          <ShieldCheck aria-hidden="true" />
          Seus dados são enviados por conexão protegida e nunca serão usados para criar acessos
          internos.
        </p>
      </section>
    </div>
  );
}
