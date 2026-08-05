import { SupportCenter } from "@/components/support-center";

export const metadata = { title: "Central de ajuda" };

export default function HelpPage() {
  return (
    <div className="container page-shell">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Ajuda curti Z</p>
          <h1>Como podemos ajudar?</h1>
          <p>Encontre uma resposta rápida ou abra um atendimento com histórico completo.</p>
        </div>
      </div>
      <SupportCenter />
    </div>
  );
}
