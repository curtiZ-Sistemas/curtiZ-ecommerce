import { Headphones, PackageCheck, ShieldCheck } from "lucide-react";

export function AuthExperienceAside() {
  return (
    <aside className="auth-aside" aria-label="Benefícios da conta curti Z">
      <div>
        <p className="eyebrow">Sua experiência curti Z</p>
        <h2>Seu estilo, seus pedidos, tudo no mesmo lugar.</h2>
        <p className="auth-aside-copy">
          Uma área feita para acompanhar cada etapa da sua experiência com clareza e segurança.
        </p>
      </div>
      <div className="auth-benefits">
        <div>
          <PackageCheck aria-hidden="true" />
          <span><strong>Pedidos organizados</strong>Histórico e andamento em um só lugar.</span>
        </div>
        <div>
          <Headphones aria-hidden="true" />
          <span><strong>Atendimento centralizado</strong>Conversas e solicitações com histórico.</span>
        </div>
        <div>
          <ShieldCheck aria-hidden="true" />
          <span><strong>Dados protegidos</strong>Acesso e ações sensíveis validados com segurança.</span>
        </div>
      </div>
    </aside>
  );
}
