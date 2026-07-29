import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Acesse sua conta", robots: { index: false, follow: false } };

export default function LoginPage() {
  return (
    <div className="auth-layout">
      <section className="auth-card">
        <p className="eyebrow">Bem-vindo de volta</p>
        <h1>Já tenho conta</h1>
        <p>Entre para acompanhar pedidos, favoritos e atendimentos.</p>
        <AuthForm mode="login" />
        <p>
          <Link className="text-link" href="/esqueci-senha">
            Esqueci minha senha
          </Link>
        </p>
      </section>
      <section className="auth-card">
        <p className="eyebrow">Primeira vez por aqui?</p>
        <h2>Criar conta</h2>
        <AuthForm mode="signup" />
      </section>
    </div>
  );
}
