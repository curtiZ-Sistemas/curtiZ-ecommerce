import type { Metadata } from "next";
import { PrivacyRequestForm } from "@/components/privacy-request-form";

export const metadata: Metadata = {
  title: "Solicitações de privacidade",
  description: "Canal para exercício de direitos relacionados a dados pessoais.",
  robots: { index: false, follow: false, noarchive: true }
};
export default function PrivacyRequestsPage() {
  return (
    <div className="container privacy-request-page">
      <header>
        <span className="eyebrow">Privacidade</span>
        <h1>Solicitações sobre dados pessoais</h1>
        <p>
          Registre seu pedido para análise e verificação de identidade. A disponibilidade de cada
          providência depende do contexto e das obrigações aplicáveis.
        </p>
      </header>
      <aside>
        <strong>Antes de enviar</strong>
        <p>
          Não informe senha, código de autenticação, cartão ou documento de identidade neste
          formulário. A equipe orientará um método seguro de verificação quando necessário.
        </p>
      </aside>
      <PrivacyRequestForm turnstileEnabled={process.env.TURNSTILE_ENABLED === "true"} />
    </div>
  );
}
