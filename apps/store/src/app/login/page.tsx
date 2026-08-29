import { safeInternalPath } from "@curtiz/security";
import Image from "next/image";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import logoCurtiz from "../../../public/images/logo-curtiz.png";

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
        <section className="auth-card auth-login-card">
          <header className="auth-card-header">
            <Image
              className="auth-logo"
              src={logoCurtiz}
              alt="curti Z"
              width={180}
              height={120}
              priority
            />
            <h1>Acesse sua conta</h1>
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
