import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Criar conta", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <div className="auth-layout" style={{ gridTemplateColumns: "1fr", maxWidth: 650 }}>
      <section className="auth-card">
        <p className="eyebrow">Conta Curtiz</p>
        <h1>Crie sua conta</h1>
        <p>Não pedimos endereço ou CPF nesta etapa.</p>
        <AuthForm mode="signup" />
      </section>
    </div>
  );
}
