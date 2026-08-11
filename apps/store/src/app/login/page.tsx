import { safeInternalPath } from "@curtiz/security";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { AuthExperienceAside } from "@/components/auth-experience-aside";

export const metadata = { title: "Acesse sua conta", robots: { index: false, follow: false } };

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string; returnTo?: string }>;
}) {
  const query = await searchParams;
  const requestedReturn = query.returnTo ?? query.next;
  const returnTo = requestedReturn ? safeInternalPath(requestedReturn, "/minha-conta") : undefined;
  const signupHref = returnTo ? `/cadastro?returnTo=${encodeURIComponent(returnTo)}` : "/cadastro";
  return (
    <div className="auth-page">
      <div className="auth-shell">
        <AuthExperienceAside />

        <section className="auth-card auth-login-card">
          <header className="auth-card-header">
            <span className="auth-kicker">Bem-vindo de volta</span>
            <h2>Acesse sua conta</h2>
            <p>Use seu e-mail e senha cadastrados para continuar.</p>
          </header>
          <AuthForm
            mode="login"
            returnTo={returnTo}
            turnstileEnabled={process.env.TURNSTILE_ENABLED === "true"}
          />
          <div className="auth-divider">
            <span>Primeira vez na curti Z?</span>
          </div>
          <Link className="secondary-button full-button auth-register-button" href={signupHref}>
            Cadastre-se
          </Link>
        </section>
      </div>
    </div>
  );
}
